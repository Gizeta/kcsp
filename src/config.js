import getopt from 'node-getopt';

let cmd = getopt.create([
    ['b', 'path=ARG', 'set base path'],
    ['c', 'cache-path=ARG', 'set cache database path'],
    ['l', 'log-path=ARG', 'set log file path'],
    ['p', 'port=ARG', 'set web port']
]).bindHelp().parseSystem();

let basePath = cmd.options['path'] || __dirname + '/..';
let logPath = cmd.options['log-path'] || (basePath + '/log');
let cachePath = cmd.options['cache-path'] || (basePath + '/cache');
let port = cmd.options['cache-path'] ? parseInt(cmd.options['cache-path']) : 8099;

module.exports = {
    basePath: basePath,
    cachePath: cachePath,
    logPath: logPath,
    port: port
};
