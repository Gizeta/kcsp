"use strict"

import http from 'http';
import url from 'url';
import request from 'request';

const PROXY   = 'http://example.org:8099/'
const TIMEOUT = 20 * 1000
const DELAY   =  2 * 1000
const RETRY   = 100


function makeRequest(opts) {
    return new Promise((resolve, reject) => {
        request(opts, (err, res, body) => {
            if (err) {
                reject(err)
            } else {
                resolve([res, body])
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


function filterHeaders(data) {
    var headers = {}
    for (var key in data) {
        if (key !== 'connection' &&
            key !== 'proxy-connection' &&
            key !== 'cache-token' &&
            key !== 'request-uri') {
            headers[key] = data[key]
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
                break
            } catch (err) {
                console.error(err)
            }
            await delay(DELAY)
        }
        if (rr) {
            let [rResp, rBody] = rr
            resp.writeHead(rResp.statusCode, filterHeaders(rResp.headers))
            resp.end(rBody)
        } else {
            resp.writeHead(503)
            resp.end()
        }

        let etime = Date.now()
        log(desc, `Finish in ${(etime - stime) / 1000}s`)
    })
}

let httpd = http.createServer()
httpd.on('request', onRequest)
httpd.listen(8099, '127.0.0.1')
console.log('HTTP proxy server listen at 8099...')
