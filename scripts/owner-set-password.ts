// Sets the owner login. Prabal runs this himself: the password is typed here and only its argon2id hash
// is written to the git-ignored .env (and copied by him to Railway). Usage: pnpm owner:set-password you@example.com
import { hash } from '@node-rs/argon2';
import { createInterface } from 'node:readline';
import { upsertEnv } from './lib/env-file';

const email = process.argv[2];
if (!email?.includes('@')) {
  console.error('usage: pnpm owner:set-password <email>');
  process.exit(1);
}

async function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  out._writeToOutput = (s: string) => out.output.write(s.includes(prompt) ? s : '');
  const answer = await new Promise<string>((r) => rl.question(prompt, r));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const pw = await ask('New owner password (min 12 chars): ');
if (pw.length < 12) {
  console.error('too short');
  process.exit(1);
}
if ((await ask('Again: ')) !== pw) {
  console.error('passwords differ');
  process.exit(1);
}
const h = await hash(pw, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
upsertEnv('OWNER_EMAIL', email.toLowerCase());
upsertEnv('OWNER_PASSWORD_HASH', h);
console.log('OWNER_EMAIL and OWNER_PASSWORD_HASH written to .env. Copy both to the Railway web service.');
