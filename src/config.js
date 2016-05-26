import getopt from 'node-getopt';

let opt = getopt.create([
    ['b', 'path=ARG',        'set the base path for all related files'],
    ['c', 'cache-path=ARG',  'set the database directory for cache'],
    ['l', 'log-path=ARG',    'set the log directory'],
    ['p', 'port=ARG',        'set the port for requests, default to 8099'],
    ['h', 'help',            'show this help']
]).bindHelp().parseSystem();

let basePath = opt.options['path'] || __dirname + '/..';
let logPath = opt.options['log-path'] || (basePath + '/log');
let cachePath = opt.options['cache-path'] || (basePath + '/cache');
let port = opt.options['port'] ? parseInt(opt.options['port']) : 8099;

function getArgs() {
    let args = [];
    ['path', 'cache-path', 'log-path', 'port'].forEach(arg => {
        if (opt.options[arg]) {
            args.push(`--${arg}=${opt.options[arg]}`)
        }
    });
    return args;
}

module.exports = {
    basePath: basePath,
    cachePath: cachePath,
    logPath: logPath,
    port: port,
    execOpt: opt,
    getArgs: getArgs
};
