// Headless end-to-end demo against Arc Testnet with real Circle calls (PRD §20 steps 1-6, §23 #2).
// Needs the web app + executor running, TWOKEY_URL, TWOKEY_AGENT_KEY, OWNER_EMAIL and DEMO_OWNER_PASSWORD,
// and APPROVAL_GRACE_SECONDS >= 3 on the web service (so the drift lands before execution).
// Every tx hash is also checked independently on the Arc RPC. Results go to docs/demo-runs/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTwokey, type PaymentResponse } from '@twokey-arc/sdk';
import { addUsdc, compareUsdc, formatUsdc6, parseUsdc } from '@twokey-arc/money';
import { ATTACKER_ADDRESS, readWallets } from './lib/wallets';

const URL_ = (process.env.TWOKEY_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const RPC = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.io';
const key = process.env.TWOKEY_AGENT_KEY;
const email = process.env.OWNER_EMAIL;
const password = process.env.DEMO_OWNER_PASSWORD;
if (!key || !email || !password) throw new Error('TWOKEY_AGENT_KEY, OWNER_EMAIL and DEMO_OWNER_PASSWORD are required');
const w = readWallets();
if (!w) throw new Error('config/wallets.arc-testnet.json missing; run pnpm circle:setup');

const run = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const { agent } = createTwokey({ baseUrl: URL_, apiKey: key });
const results: { step: string; ok: boolean; detail: string; txHash?: string; ms?: number }[] = [];
const fail = (msg: string): never => {
  throw new Error(msg);
};
const check = (cond: unknown, msg: string) => cond || fail(msg);

// Owner session (approvals need a person's session, never the agent key).
const login = await fetch(`${URL_}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
check(login.ok, `owner login failed: ${login.status}`);
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const { csrf } = (await login.json()) as { csrf: string };
const owner = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> => {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as T };
};

async function arcReceipt(txHash: string): Promise<{ status: string; blockNumber: string } | null> {
  // Local simulation only: there is no Arc transaction to look up. Never set this for evidence runs.
  if (process.env.DEMO_RUN_SIMULATED === '1') return { status: '0x1', blockNumber: '0x0' };
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }) });
  return ((await res.json()) as { result: { status: string; blockNumber: string } | null }).result;
}

const wallet0 = (await owner<{ usdc: string; takenAt: string }>('GET', '/api/v1/wallet')).json;
console.log(`run ${run} · treasury USDC ${wallet0.usdc}`);
const paid: PaymentResponse[] = [];

async function step(name: string, fn: () => Promise<string | { detail: string; txHash?: string; ms?: number }>) {
  try {
    const r = await fn();
    const o = typeof r === 'string' ? { detail: r } : r;
    results.push({ step: name, ok: true, ...o });
    console.log(`✓ ${name} · ${o.detail}`);
  } catch (err) {
    results.push({ step: name, ok: false, detail: (err as Error).message });
    console.log(`✗ ${name} · ${(err as Error).message}`);
  }
}

const pay = (idem: string, payee: Record<string, string>, amount: string, memo: string) =>
  agent.guard({ type: 'PAY', payee, amount, memo }, { agentId: 'ap-agent', idempotencyKey: `${idem}:${run}` });

await step('1 inside the mandate: Oceanic 0.25 runs on its own and is final on Arc', async () => {
  const t0 = Date.now();
  const r = await pay('INV-88213', { payeeId: 'pay_oceanic' }, '0.25', 'INV-88213');
  check(r.outcome === 'executed' && r.ruleId === 'R-WM-PAY', `expected executed/R-WM-PAY, got ${r.outcome}/${r.ruleId}`);
  const p = await agent.waitFor(r.paymentId, { timeoutMs: 60_000, intervalMs: 500 });
  const ms = Date.now() - t0;
  check(p.status === 'PAID' && p.txHash, `expected PAID with tx hash, got ${p.status}`);
  const rc = await arcReceipt(p.txHash!);
  check(rc?.status === '0x1', `Arc RPC receipt status ${rc?.status}`);
  paid.push(p);
  return { detail: `PAID in ${(ms / 1000).toFixed(1)} s · block ${parseInt(rc!.blockNumber, 16)}`, txHash: p.txHash!, ms };
});

await step('2 outside the mandate: Brightline 0.75 waits for the second key, then pays', async () => {
  const r = await pay('BM-7', { name: 'Brightline Media', address: w.payees.brightline.address }, '0.75', 'BM-7');
  check(r.outcome === 'pending_approval', `expected pending_approval, got ${r.outcome}`);
  const failed = r.checks.filter((c) => !c.pass).map((c) => c.id).sort().join(',');
  check(failed === 'payee_known,per_tx_limit', `failed checks ${failed}`);
  const pre = await agent.getPayment(r.paymentId);
  check(pre.status === 'AWAITING_APPROVAL' && !pre.circleTransactionId, 'a Circle call happened before approval');
  const ap = await owner<{ seal: string }>('GET', `/api/v1/approvals/${r.approval!.id}`);
  const stale = await owner('POST', `/api/v1/approvals/${r.approval!.id}/approve`, { seal: `sha256:${'0'.repeat(64)}` });
  check(stale.status === 409, `stale seal gave ${stale.status}, expected 409`);
  const ok = await owner('POST', `/api/v1/approvals/${r.approval!.id}/approve`, { seal: ap.json.seal });
  check(ok.status === 200, `approve gave ${ok.status}`);
  const p = await agent.waitFor(r.paymentId, { timeoutMs: 90_000, intervalMs: 500 });
  check(p.status === 'PAID' && p.txHash, `expected PAID, got ${p.status}`);
  check((await arcReceipt(p.txHash!))?.status === '0x1', 'Arc RPC receipt not successful');
  paid.push(p);
  return { detail: 'stale seal 409, approved seal → PAID', txHash: p.txHash! };
});

await step('3 breaks a rule: "Oceanic" at a new address is blocked, no Circle call', async () => {
  const r = await pay('INV-88240', { name: 'Oceanic Freight', address: ATTACKER_ADDRESS }, '0.40', 'INV-88240');
  check(r.outcome === 'blocked' && r.ruleId === 'INV-PAYEE-PINNED', `got ${r.outcome}/${r.ruleId}`);
  const p = await agent.getPayment(r.paymentId);
  check(p.status === 'BLOCKED' && !p.circleTransactionId, 'blocked payment reached Circle');
  return 'blocked · INV-PAYEE-PINNED';
});

await step('4 drift: Harbor 0.60 approved, amount changed by 0.50, approval void, nothing sent', async () => {
  const r = await pay('HC-2210', { payeeId: 'pay_harbor' }, '0.60', 'HC-2210');
  check(r.outcome === 'pending_approval', `expected pending_approval, got ${r.outcome}`);
  const ap = await owner<{ seal: string }>('GET', `/api/v1/approvals/${r.approval!.id}`);
  check((await owner('POST', `/api/v1/approvals/${r.approval!.id}/approve`, { seal: ap.json.seal })).status === 200, 'approve failed');
  const d = await owner<{ from: string; to: string }>('POST', `/api/demo/drift/${r.paymentId}`, { delta: '0.50' });
  check(d.status === 200, `drift gave ${d.status} (is DEMO_MODE on and APPROVAL_GRACE_SECONDS >= 3?)`);
  const p = await agent.waitFor(r.paymentId, { timeoutMs: 60_000, intervalMs: 500 });
  check(p.status === 'VOIDED' && !p.circleTransactionId, `expected VOIDED with no Circle tx, got ${p.status}`);
  return `amount ${d.json.from} → ${d.json.to} · VOIDED · no Circle call`;
});

await step('5 idempotency: INV-88213 retried with the same key returns the same payment', async () => {
  const r = await pay('INV-88213', { payeeId: 'pay_oceanic' }, '0.25', 'INV-88213');
  check(paid[0] && r.paymentId === paid[0].paymentId, 'retry created a new payment');
  return `same paymentId ${r.paymentId}`;
});

await step('6 audit: chain verifies and each paid payment has its Circle tx id and Arc tx hash', async () => {
  const v = await owner<{ ok: boolean; length: number }>('GET', '/api/v1/audit/verify');
  check(v.json.ok, 'audit chain broken');
  const a = await owner<{ entries: { verb: string; subject_id: string; data: Record<string, string> }[] }>('GET', '/api/v1/audit?limit=5000');
  for (const p of paid) {
    const created = a.json.entries.find((e) => e.verb === 'circle.transaction_created' && e.subject_id === p.paymentId);
    const done = a.json.entries.find((e) => e.verb === 'payment.completed' && e.subject_id === p.paymentId);
    check(created?.data.circle_transaction_id && done?.data.tx_hash === p.txHash, `audit incomplete for ${p.paymentId}`);
  }
  return `chain ok · ${v.json.length} entries`;
});

await step('7 balance: treasury dropped by exactly the amounts paid plus their USDC gas', async () => {
  const a = await owner<{ entries: { verb: string; subject_id: string; data: Record<string, string> }[] }>('GET', '/api/v1/audit?limit=5000');
  let expected = '0';
  for (const p of paid) {
    const fee = a.json.entries.find((e) => e.verb === 'payment.completed' && e.subject_id === p.paymentId)?.data.fee ?? '0';
    expected = addUsdc(expected, addUsdc(p.amount, fee));
  }
  // Wait for a balance snapshot taken after the last payment.
  let w1 = wallet0;
  for (let i = 0; i < 40 && w1.takenAt === wallet0.takenAt; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    w1 = (await owner<typeof wallet0>('GET', '/api/v1/wallet')).json;
  }
  const delta = formatUsdc6(parseUsdc(wallet0.usdc) - parseUsdc(w1.usdc));
  // Circle reports the fee with up to 18 decimals; we round it up to 6, so allow 1 micro-USDC per payment.
  const diff = parseUsdc(expected) - parseUsdc(delta);
  check(diff >= 0n && diff <= BigInt(paid.length), `balance delta ${delta}, expected ${expected}`);
  return `${wallet0.usdc} → ${w1.usdc} · delta ${delta} (amounts + fees ${expected}${compareUsdc(delta, expected) ? ', fee rounding' : ''})`;
});

const ok = results.every((r) => r.ok);
if (process.env.DEMO_RUN_SIMULATED === '1') {
  console.log(`\n${ok ? 'PASS' : 'FAIL'} (SIMULATED Circle: not evidence, nothing written to docs/demo-runs)`);
  process.exit(ok ? 0 : 1);
}
mkdirSync(resolve(import.meta.dirname, '../docs/demo-runs'), { recursive: true });
writeFileSync(resolve(import.meta.dirname, `../docs/demo-runs/${run}.json`), `${JSON.stringify({ run, url: URL_, ok, results }, null, 2)}\n`);
console.log(`\n${ok ? 'PASS' : 'FAIL'} · tx hashes:`);
for (const r of results.filter((x) => x.txHash)) console.log(`  https://explorer.testnet.arc.io/tx/${r.txHash}`);
process.exit(ok ? 0 : 1);
