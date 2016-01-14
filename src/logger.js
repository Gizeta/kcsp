import tracer from 'tracer';
import fs from 'fs';
import config from './config';

(function(){
    if (!fs.existsSync(config.logPath)) {
        fs.mkdirSync(config.logPath);
    }
})();

module.exports = tracer.dailyfile({root: config.logPath});
