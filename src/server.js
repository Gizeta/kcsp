import http from 'http'
import url from 'url'
import zlib from 'zlib'
import request from 'request'
import querystring from 'querystring'
import logger from './logger'
import * as db from './db'

const responseError = {
    403: '<h1>HTTP 403 - Forbidden</h1>参数错误或无访问权限。',
    410: '<h1>HTTP 410 - Gone</h1>获取数据失败。',
    500: '<h1>HTTP 500 - Internal Server Error</h1>服务器内部执行过程中遇到错误。请向webmaster提交错误报告以解决问题。',
    503: '<h1>HTTP 503 - Service Unavailable</h1>暂未获取到数据。请稍后再试。'
}

let server = http.createServer((req, resp) => {
    let stime = Date.now()
    let ip = getIp(req)

    let chunks = []
    req.on('data', chunk => {
        chunks.push(chunk)
    })

    req.on('end', async () => {
        logger.info(`accept request: ${req.url}, ip ${ip}`)
        let body = Buffer.concat(chunks)

        try {
            let locked = await db.get('lock')
            if (locked === 'true') {
                throw new Error('unavailable')
            }
            let urlp = url.parse(req.url)
            if (! urlp.pathname.startsWith('/kcsapi/')) {
                throw new Error('forbidden')
            }
            let id = getRequestId(req, body)

            let content = await processRequest(req, body, id)
            renderContent(resp, {
                ...content,
                acceptEncoding: req.headers['accept-encoding'] || ''
            })
            logger.info(`response to: ${req.url}, ip ${ip}`)
        }
        catch(err) {
            let errCode = 500
            switch(err.message) {
                case "unavailable":
                    errCode = 503
                    break
                case "gone":
                    errCode = 410
                    break
                case "forbidden":
                    errCode = 403
                    break
            }
            renderErrorPage(resp, errCode)
            logger.info(`response ${errCode}: ${req.url}, ip ${ip}`)
        }

        logger.info(`finish request: ${req.url}, ip ${ip}, handled in ${(Date.now() - stime) / 1000}s`)
    })
})

function getIp(req) {
    return req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress
}

function getRequestId(req, body) {
    let bodyp = querystring.parse(body.toString())
    let user  = bodyp.api_token
    let token = req.headers['cache-token']
    if (user != null && token != null) {
        return `${user}-${token}`
    } else {
        throw new Error('forbidden')
    }
}

async function processRequest(req, body, id) {
    logger.info(`process request: ${req.url}, id ${id}`)

    let data = await db.get(id)
    if (data === '__REQUEST__') {
        throw new Error('unavailable')
    }
    else if (data === '__BLOCK__') {
        throw new Error('gone')
    }
    else if (data != null) {
        return {
            statusCode: 200,
            content: data
        }
    }
    else {
        try {
            logger.info(`requesting: ${req.url}`)
            db.put(id, '__REQUEST__')

            let headers = filterHeaders(req.headers)
            let rr = await makeRequest({
                method: req.method,
                url:    req.url,
                body:   body,
                headers: headers,
                timeout: 180000,
                gzip:    true
            })

            if (rr.statusCode >= 400) {
                logger.error([
                    `request responsed: ${req.url}, code ${rr.statusCode}`,
                    `body: ${body}`,
                    `headers: ${JSON.stringify(headers)}`,
                    `response: ${rr.body}`
                ].join('\n\t'))
            } else {
                logger.info(`request responsed: ${req.url}, code ${rr.statusCode}`)
            }
            db.put(id, rr.body)
            return {
                statusCode: rr.statusCode,
                content: rr.body
            }
        }
        catch (e) {
            logger.error([
                `request error: ${req.url}`,
                `error: ${error}`,
                `body: ${body}`
                `headers: ${JSON.stringify(headers)}`,
            ].join('\n\t'))
            db.put(id, '__BLOCK__')
            throw new Error('gone')
        }
    }
}

function makeRequest(opts) {
    return new Promise((resolve, reject) => {
        request(opts, (err, res, body) => {
            if (err) {
                reject(err)
            } else {
                resolve(res)
            }
        })
    })
}

function filterHeaders(data) {
    var headers = {}
    for (var key in data) {
        if (key !== 'host' &&
            key !== 'expect' &&
            key !== 'connection' &&
            key !== 'proxy-connection' &&
            key !== 'content-length' &&
            key !== 'cache-token') {
            headers[key] = data[key]
        }
    }
    return headers
}

function renderContent(resp, data) {
    if (data.acceptEncoding.indexOf('gzip') >= 0) {
        zlib.gzip(data.content, function(err, result) {
            if (err) {
                logger.error([
                    'meet error during compressing.',
                    `error: ${err}`,
                    `content: ${data.content}`
                ].join('\n\t'))
                throw new Error(err)
            }

            resp.writeHead(data.statusCode, {'content-type': 'text/plain', 'content-encoding': 'gzip'})
            resp.end(result)
        })
    }
    else if (data.acceptEncoding.indexOf('deflate') >= 0) {
        zlib.deflate(data.content, function(err, result) {
            if (err) {
                logger.error([
                    'meet error during compressing.',
                    `error: ${err}`,
                    `content: ${data.content}`
                ].join('\n\t'))
                throw new Error(err)
            }

            resp.writeHead(data.statusCode, {'content-type': 'text/plain', 'content-encoding': 'deflate'})
            resp.end(result)
        })
    }
    else {
        resp.writeHead(data.statusCode, {'content-type': 'text/plain'})
        resp.end(result)
    }
}

function renderErrorPage(resp, code) {
    resp.writeHead(code, {'content-type': 'text/html'})
    resp.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>')
    resp.write(responseError[code])
    resp.end('<hr/>Powered by KCSP Server</body></html>')
}

export default server
