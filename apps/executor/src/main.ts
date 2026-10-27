import pino from 'pino';
import { circleClientFromEnv } from '@twokey-arc/circle';
import { circlePort } from './circle-port';
import { loadConfig } from './config';
import { runExecutor } from './run';
import { seedMandateIfMissing } from './seed';

const log = pino({
  name: 'twokey-executor',
  redact: { paths: ['*.apiKey', '*.entitySecret', '*.token', '*.authorization', 'CIRCLE_API_KEY', 'CIRCLE_ENTITY_SECRET'], censor: '[redacted]' },
});

const conf = loadConfig();
const client = circleClientFromEnv();
if (process.env.SEED_MANDATE_ON_BOOT === 'true') await seedMandateIfMissing(conf, log);
await runExecutor(conf, circlePort(client, conf.net), log, client);
