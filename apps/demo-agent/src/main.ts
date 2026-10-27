// The scripted accounts-payable agent for the video. It reads the demo inbox and calls one tool,
// twokey_pay, per invoice. It holds only a Twokey agent key: no wallet, no Circle credentials.
// Usage: pnpm demo:agent [--run <suffix>] [--only <invoice id>]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTwokey, twokeyTools } from '@twokey-arc/sdk';
import { loadInbox } from './inbox';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const url = process.env.TWOKEY_URL ?? 'http://localhost:3000';
const key = process.env.TWOKEY_AGENT_KEY;
if (!key) throw new Error('TWOKEY_AGENT_KEY is not set (pnpm seed writes it)');

const wallets = JSON.parse(readFileSync(process.env.TWOKEY_WALLETS_FILE ?? resolve(import.meta.dirname, '../../../config/wallets.arc-testnet.json'), 'utf8')) as {
  payees: { brightline: { address: string } };
};
const inbox = loadInbox({ BRIGHTLINE: wallets.payees.brightline.address, ATTACKER: '0xD15ea5E000000000000000000000000000000BAD' });
const { agent } = createTwokey({ baseUrl: url, apiKey: key });
const tools = twokeyTools(agent, 'ap-agent');

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const color = { executed: '\x1b[32m', pending_approval: '\x1b[33m', blocked: '\x1b[31m' } as const;
const run = arg('run');
const only = arg('only');

for (const email of inbox.filter((e) => !only || e.id === only)) {
  console.log(`\n${dim('inbox')}  ${email.subject}  ${dim(`<${email.from}>`)}`);
  const input = { ...email.extracted, idempotency_key: run ? `invoice:${email.id}:${run}` : `invoice:${email.id}` };
  console.log(`${dim('agent')}  twokey_pay ${JSON.stringify({ ...email.extracted })}`);
  const r = await tools.twokey_pay(input);
  console.log(`${dim('twokey')} ${color[r.outcome]}${r.outcome}\x1b[0m · ${r.ruleId} · ${r.checks.filter((c) => !c.pass).map((c) => c.detail).join(', ') || 'all checks pass'}`);
  if (r.outcome === 'executed') {
    const paid = await agent.waitFor(r.paymentId, { timeoutMs: 60_000 });
    console.log(`${dim('arc')}    ${paid.status}${paid.explorerUrl ? ` · ${paid.explorerUrl}` : ''}`);
  } else if (r.outcome === 'pending_approval') {
    console.log(`${dim('agent')}  waiting for a person to approve (${r.approval?.id}); moving on`);
  } else {
    console.log(`${dim('agent')}  refused; not retrying with changed details`);
  }
}
