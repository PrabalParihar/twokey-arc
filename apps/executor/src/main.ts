import pino from 'pino';
import { circleClientFromEnv } from '@twokey-arc/circle';
import { circlePort } from './circle-port';
import { loadConfig } from './config';
import { runExecutor } from './run';

const log = pino({
  name: 'twokey-executor',
  redact: { paths: ['*.apiKey', '*.entitySecret', '*.token', '*.authorization', 'CIRCLE_API_KEY', 'CIRCLE_ENTITY_SECRET'], censor: '[redacted]' },
});

const conf = loadConfig();
const client = circleClientFromEnv();
await runExecutor(conf, circlePort(client, conf.net), log, client);
