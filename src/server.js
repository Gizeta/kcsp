import http from 'http'
import net from 'net'
import url from 'url'
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

async function onConnect(req, sock) {
    let ip = getIp(req)
    logger.info(`accept connect: ${req.url}, ip ${ip}`)

    let urlp = url.parse(`http://${req.url}`)
    let rSock = net.createConnection({
        host: urlp.hostname,
        port: urlp.port || 80,
    })
    rSock.on('connect', () => {
        logger.info(`process connect: ${req.url}`)
        sock.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        sock.pipe(rSock)
        rSock.pipe(sock)
    })
    rSock.on('error', (err) => {
        logger.info(`process connect error: ${req.url} ${err}`)
        sock.end()
        rSock.end()
    })
    sock.on('close', () => rSock.end())
    rSock.on('close', () => sock.end())
}

async function onRequest(req, resp) {
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
            let data;
            if (isGameAPI(req)) {
                let locked = await db.get('lock')
                if (locked === 'true') {
                    throw new Error('unavailable')
                }
                let id = getRequestId(req, body)
                data = await processAPIRequest(req, body, id)
            } else {
                data = await processRequest(req, body)
            }

            resp.writeHead(data.statusCode, data.headers)
            resp.end(data.content)
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
            logger.error([
                `response ${errCode}: ${req.url}, ip ${ip}`,
                `error: ${err}`
                ].join('\n\t'))
        }

        logger.info(`finish request: ${req.url}, ip ${ip}, handled in ${(Date.now() - stime) / 1000}s`)
    })
}

async function processAPIRequest(req, body, id) {
    logger.info(`process request: ${req.url}, id ${id}`)

    let data = await db.get(id)
    if (data === '__REQUEST__') {
        throw new Error('unavailable')
    }
    else if (data === '__BLOCK__') {
        throw new Error('gone')
    }
    else if (data != null) {
        try {
            return JSON.parse(data, (key, value) =>
                (value && value.type === 'Buffer') ? new Buffer(value.data) : value)
        }
        catch (err) {
            logger.error([
                    'parse db data error:',
                    `error: ${err}`,
                    `data: ${data}`
                ].join('\n\t'))
            throw new Error('gone')
        }
    }
    else {
        try {
            logger.info(`requesting: ${req.url}`)
            db.put(id, '__REQUEST__')

            let rr = await makeRequest({
                method:  req.method,
                url:     req.url,
                body:    (body.length > 0) ? body : null,
                headers: filterHeaders(req.headers),
                encoding: null,
                timeout: 180000,
            })
            if (rr.statusCode >= 400) {
                logger.error([
                    `request responsed: ${req.url}, code ${rr.statusCode}`,
                    `body: ${body}`,
                    `headers: ${JSON.stringify(req.headers)}`,
                    `response: ${rr.body}`
                ].join('\n\t'))
            } else {
                logger.info(`request responsed: ${req.url}, code ${rr.statusCode}`)
            }

            let cacheObj = {
                statusCode: rr.statusCode,
                headers:    filterHeaders(rr.headers),
                content:    rr.body,
            }
            db.put(id, JSON.stringify(cacheObj))
            return cacheObj
        }
        catch (err) {
            logger.error([
                `request error: ${req.url}`,
                `error: ${err}`,
                `body: ${body}`,
                `headers: ${JSON.stringify(req.headers)}`,
            ].join('\n\t'))
            db.put(id, '__BLOCK__')
            throw new Error('gone')
        }
    }
}

async function processRequest(req, body) {
    logger.info(`process request: ${req.url}`)
    try {
        let rr = await makeRequest({
            method:  req.method,
            url:     req.url,
            body:    (body.length > 0) ? body : null,
            headers: filterHeaders(req.headers),
            encoding: null,
        })
        return {
            statusCode: rr.statusCode,
            headers:    filterHeaders(rr.headers),
            content:    rr.body,
        }
    }
    catch (err) {
        throw new Error('unavailable')
    }
}

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

function isGameAPI(req) {
    let urlp = url.parse(req.url)
    return urlp.pathname.startsWith('/kcsapi/')
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

function renderErrorPage(resp, code) {
    resp.writeHead(code, {'content-type': 'text/html'})
    resp.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>')
    resp.write(responseError[code])
    resp.end('<hr/>Powered by KCSP Server</body></html>')
}


let server = http.createServer()
server.on('connect', onConnect)
server.on('request', onRequest)

export default server
