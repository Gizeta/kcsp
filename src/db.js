import levelup from 'level';
import ttl from 'level-ttl';
import config from './config';
import logger from './logger';

let db = levelup(config.cachePath);
db = ttl(db, {
    checkFrequency: 2 * 60 * 60 * 1000,
    defaultTTL: 30 * 60 * 1000
});

export async function get(key) {
    return new Promise((resolve, reject) => {
        db.get(key, function(err, value) {
            if (err) {
                if (err.notFound) {
                    resolve();
                    return;
                }
                logger.error('database error, %s', err);
                reject(err);
                return;
            }
            resolve(value);
        });
    });
}

export function put(key, value) {
    db.put(key, value, function(err) {
        if (err) {
            logger.error('database error, %s', err);
        }
    });
}

export function del(key) {
    db.del(key, function(err) {
        if (err) {
            logger.error('database error, %s', err);
        }
    });
}
