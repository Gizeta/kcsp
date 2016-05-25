#!/usr/bin/env babel-node
"use strict"

const http = require('http')
const request = require('request')

const PROXY = 'http://example.org:8099/'
const RETRY = 100


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

function lspad(n) {
    let p = "  "
    let s = n.toString()
    return (p + s).slice(-p.length);
};


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
    let time = Date.now()
    let nonce = Math.random().toString(36).substring(2, 18)
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
            encoding: null,
            followRedirect: false
        }
        if (body.length > 0) {
            opts.body = body
        }
        let token = getRequestId(req)
        opts.headers['request-uri'] = opts.url
        opts.headers['cache-token'] = token

        let desc = `${token} ${opts.url}`

        let rr = null
        for (let i of Array(RETRY).keys()) {
            console.log(`Try ${lspad(i)}: ${desc}`)
            try {
                rr = await makeRequest(opts)
                break
            } catch (err) {
                console.log(err)
            }
            await delay(3000)
        }
        if (rr) {
            let [rResp, rBody] = rr
            resp.writeHead(rResp.statusCode, filterHeaders(rResp.headers))
            resp.end(rBody)
        } else {
            resp.writeHead(503)
            resp.end()
        }
        console.log(`Finish: ${desc}`)
    })
}

let httpd = http.createServer()
httpd.on('request', onRequest)
httpd.listen(8099)
console.log('Server listen at 8099...')
