import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ENV_PATH = resolve(import.meta.dirname, '../../.env');

/** Sets KEY='value' in the git-ignored .env, replacing an existing line. Values are never echoed. */
export function upsertEnv(key: string, value: string): void {
  if (/['\n]/.test(value)) throw new Error(`${key}: value cannot contain quotes or newlines`);
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8').split('\n') : [];
  const line = `${key}='${value}'`;
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = line;
  else lines.push(line);
  writeFileSync(ENV_PATH, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
}
