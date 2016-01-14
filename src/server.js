import http from 'http';
import url from 'url';
import request from 'request';
import zlib from 'zlib';
import logger from './logger';
import * as db from './db';
import env from './env';

const responseError = {
    403: '<h1>HTTP 403 - Forbidden</h1>参数错误或无访问权限。',
    410: '<h1>HTTP 410 - Gone</h1>获取数据失败。',
    500: '<h1>HTTP 500 - Internal Server Error</h1>服务器内部执行过程中遇到错误。请向webmaster提交错误报告以解决问题。',
    503: '<h1>HTTP 503 - Service Unavailable</h1>暂未获取到数据。请稍后再试。'
}

const kcIpList = [
    '203.104.209.7',
    '203.104.209.71',
    '125.6.184.15',
    '125.6.184.16',
    '125.6.187.205',
    '125.6.187.229',
    '125.6.187.253',
    '125.6.188.25',
    '203.104.248.135',
    '125.6.189.7',
    '125.6.189.39',
    '125.6.189.71',
    '125.6.189.103',
    '125.6.189.135',
    '125.6.189.167',
    '125.6.189.215',
    '125.6.189.247',
    '203.104.209.23',
    '203.104.209.39',
    '203.104.209.55',
    '203.104.209.102'
];
const kcCacheableApiList = [
    '/kcsapi/api_start2'
];

let server = http.createServer((req, resp) => {
    let chunks = [];
    let chunkSize = 0;
    req.params = {
        ip: getIp(req),
        requestPath: '',
        postData: '',
        requestTime: new Date().getTime()
    };

    req.on('data', chunk => {
        chunks.push(chunk);
        chunkSize += chunk.length;
    });

    req.on('end', async () => {
        let data = null;
        switch (chunks.length) {
            case 0:
                data = new Buffer(0);
                break;
            case 1:
                data = chunks[0];
                break;
            default:
                data = new Buffer(chunkSize);
                for (var i = 0, pos = 0, l = chunks.length; i < l; i++) {
                    var chunk = chunks[i];
                    chunk.copy(data, pos);
                    pos += chunk.length;
                }
                break;
        }
        req.params.postData = data.toString();

        logger.info(`${req.params.ip} requests ${req.url}`);

        let locked = await db.get('lock');
        if (locked === 'true') {
            renderErrorPage(resp, 503);
            logger.info(`send error 503 to ${req.params.ip}, handled in ${(new Date().getTime() - req.params.requestTime) / 1000}s`);
            return;
        }

        if (!validateRequest(req)) {
            renderErrorPage(resp, 403);
            logger.info(`send error 403 to ${req.params.ip}, handled in ${(new Date().getTime() - req.params.requestTime) / 1000}s`);
            return;
        }

        try {
            let content = await processRequest(req);
            renderContent(resp, {
                ...content,
                acceptEncoding: req.headers['accept-encoding'] || ''
            });
            logger.info(`response to ${req.params.ip}, handled in ${(new Date().getTime() - req.params.requestTime) / 1000}s`);
        }
        catch(err) {
            let errCode = 500;
            switch(err) {
                case "unavailable":
                    errCode = 503;
                    break;
                case "gone":
                    errCode = 410;
                    break;
                case "forbidden":
                    errCode = 403;
                    break;
            }
            renderErrorPage(resp, errCode);
            logger.info(`send error ${errCode} to ${req.params.ip}, handled in ${(new Date().getTime() - req.params.requestTime) / 1000}s`);
        }
    });
});

function validateRequest(req) {
    if (req.method !== 'POST' ||
        req.headers['request-uri'] == null ||
        req.headers['cache-token'] == null)
        return false;

    let objUrl = url.parse(req.headers['request-uri']);
    if (objUrl.pathname.startsWith('/kcsapi/') && kcIpList.indexOf(objUrl.hostname) >= 0) {
        req.params.requestPath = objUrl.pathname;
        return true;
    }

    return false;
}

async function processRequest(req) {
    let cacheable = kcCacheableApiList.indexOf(req.params.requestPath) >= 0;
    let cacheToken = cacheable ? req.params.requestPath : req.headers['cache-token'];

    logger.info(`process request, user: ${req.params.ip}, token: ${cacheToken}`);

    let data = await db.get(cacheToken);
    if (data === '__REQUEST__') {
        throw new Error('unavailable');
    }
    else if (data === '__BLOCK__') {
        throw new Error('gone');
    }
    else if (data != null) {
        /* maybe still need to post to KADOKAWA although api data can be cached like api_start2 */
        /* not implement to avoid sending repeat request */

        return {
            statusCode: 200,
            content: data
        };
    }
    else {
        return await postToRemote({
            url: req.headers['request-uri'],
            headers: filterHeaders(req.headers),
            postData: req.params.postData,
            cacheToken: cacheToken,
            cacheable: cacheable
        });
    }
}

async function postToRemote(conn) {
    logger.info(`requesting ${conn.url}`);

    db.put(conn.cacheToken, '__REQUEST__');
    return new Promise((resolve, reject) => {
        request.post({
            url: conn.url,
            form: conn.postData,
            headers: conn.headers,
            timeout: 180000,
            gzip: true
        }, function(error, response, body) {
            if (error) {
                logger.error([
                    'meet error during requesting.',
                    `error: ${error}`,
                    `url: ${conn.url}`,
                    `headers: ${JSON.stringify(conn.headers)}`,
                    `post: ${conn.postData}`
                ].join('\n\t'));

                if (conn.cacheable) {
                    reject(new Error('unavailable'));
                }
                else {
                    db.put(conn.cacheToken, '__BLOCK__');
                    reject(new Error('gone'));
                }
                return;
            }

            if (response.statusCode >= 400) {
                logger.error([
                    'remote server response error.',
                    `code: ${response.statusCode}`,
                    `url: ${conn.url}`,
                    `headers: ${JSON.stringify(conn.headers)}`,
                    `post: ${conn.postData}`,
                    `response: ${body}`
                ].join('\n\t'));

                if (conn.cacheable) {
                    reject(new Error('unavailable'));
                }
                else {
                    db.put(conn.cacheToken, body);
                    resolve({
                        statusCode: response.statusCode,
                        content: body
                    });
                }
                return;
            }

            logger.info(`remote server responsed, code: ${response.statusCode}`);
            db.put(conn.cacheToken, body);
            resolve({
                statusCode: response.statusCode,
                content: body
            });
        });
    });
}

function filterHeaders(data) {
    var headers = {};
    for (var key in data) {
        if (key !== 'host' &&
            key !== 'expect' &&
            key !== 'connection' &&
            key !== 'proxy-connection' &&
            key !== 'content-length' &&
            key !== 'cache-token' &&
            key !== 'request-uri') {
            headers[key] = data[key];
        }
    }

    return headers;
}

function getIp(req) {
    return req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress;
}

function renderContent(resp, data) {
    if (data.acceptEncoding.indexOf('gzip') >= 0) {
        zlib.gzip(data.content, function(err, result) {
            if (err) {
                logger.error([
                    'meet error during compressing.',
                    `error: ${err}`,
                    `content: ${data.content}`
                ].join('\n\t'));
                throw new Error(err);
            }

            resp.writeHead(data.statusCode, {'content-type': 'text/plain', 'content-encoding': 'gzip'});
            resp.end(result);
        });
    }
    else if (data.acceptEncoding.indexOf('deflate') >= 0) {
        zlib.deflate(data.content, function(err, result) {
            if (err) {
                logger.error([
                    'meet error during compressing.',
                    `error: ${err}`,
                    `content: ${data.content}`
                ].join('\n\t'));
                throw new Error(err);
            }

            resp.writeHead(data.statusCode, {'content-type': 'text/plain', 'content-encoding': 'deflate'});
            resp.end(result);
        });
    }
    else {
        resp.writeHead(data.statusCode, {'content-type': 'text/plain'});
        resp.end(result);
    }
}

function renderErrorPage(resp, code) {
    resp.writeHead(code, {'content-type': 'text/html'});
    resp.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>');
    resp.write(responseError[code]);
    resp.end('<hr/>Powered by KCSP Server/' + env.APP_VERSION + '</body></html>');
}

export default server;
