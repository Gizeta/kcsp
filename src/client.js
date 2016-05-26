"use strict"

import http from 'http';
import url from 'url';
import request from 'request';

let PROXY, RETRY, TIMEOUT, DELAY;


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

function delay(ms) {
    return new Promise((resolve, reject) => {
        setTimeout(() => resolve(), ms)
    })
}

function log(desc, msg) {
    console.log(desc, ':', msg)
}


function filterHeaders(origin) {
    let headers = {}
    for (let key in origin) {
        if (! ['connection', 'proxy-connection', 'cache-token', 'request-uri'].includes(key)) {
            headers[key] = origin[key]
        }
    }
    return headers
}

function getRequestId(req) {
    let time = Date.now().toString().slice(-8)
    let nonce = Math.random().toString(36).slice(-16)
    return `${time}-${nonce}`
}

async function onRequest(req, resp) {
    let body = new Buffer(0)
    req.on('data', (chunk) => {
        body = Buffer.concat([body, chunk])
    })
    req.on('end', async () => {
        let opts = {
            method:  req.method,
            url:     req.url,
            headers: filterHeaders(req.headers),
            proxy:   PROXY,
            timeout: TIMEOUT,
            encoding: null,
            followRedirect: false
        }
        if (body.length > 0) {
            opts.body = body
        }
        let token = getRequestId(req)
        opts.headers['request-uri'] = opts.url
        opts.headers['cache-token'] = token

        let oUrl = url.parse(opts.url)
        let desc = `${token} ${oUrl.pathname}`
        let stime = Date.now()

        let rr = null
        for (let i of Array(RETRY).keys()) {
            log(desc, `Try #${i}`)
            try {
                rr = await makeRequest(opts)
                if (! (rr.statusCode === 503)) {
                    break
                }
            } catch (e) {
                if (! ['ECONNRESET', 'ENOTFOUND', 'ESOCKETTIMEDOUT', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'EPIPE', 'EAI_AGAIN'].includes(e.code)) {
                    console.error(e)
                }
            }
            await delay(DELAY)
        }
        if (rr) {
            resp.writeHead(rr.statusCode, filterHeaders(rr.headers))
            resp.end(rr.body)
        } else {
            resp.writeHead(503)
            resp.end()
        }

        let etime = Date.now()
        log(desc, `Fin ${(etime - stime) / 1000}s`)
    })
}

function start(host, port, retry, timeout) {
    PROXY = `http://${host}:${port}/`
    RETRY = retry
    TIMEOUT = timeout * 1000
    DELAY = 2 * 1000

    let httpd = http.createServer()
    httpd.on('request', onRequest)
    httpd.listen(8099, '127.0.0.1', () => {
        let port = httpd.address().port
        console.log(`Upstream proxy server is ${PROXY}`)
        console.log(`Local proxy server listen at ${port}`)
    })
}

module.exports = start;
