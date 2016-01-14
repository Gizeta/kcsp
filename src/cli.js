import server from './server';
import config from './config';
import logger from './logger';
import 'babel-polyfill';

server.listen(config.port);
logger.info('kcsp server started.');
