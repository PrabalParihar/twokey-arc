import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { and, count, desc, eq, gte, inArray, like } from 'drizzle-orm';
import { approvals, attempts, paymentIntents } from '@twokey-arc/db';
import { decideApproval, driftDemo, getActiveMandate, latestBalance, requestPayment, TwokeyError } from '@twokey-arc/core';
import { db, demoCfg, DEMO_ENABLED, deps } from './server';

/**
 * The public demo: any visitor runs a scripted agent against the demo org (its own Circle wallet on Arc
 * Testnet, its own mandate and executor) and countersigns one payment. Visitors are an anonymous cookie;
 * every payment they cause carries it in its idempotency key, which is how we scope reads and decisions.
 */
export const DEMO_COOKIE = 'tk_demo';
export const DEMO_AGENT = 'demo-agent';
const VISITOR_BY = 'demo visitor';

// Brightline is a Circle wallet from config/wallets.arc-testnet.json that the demo mandate does not list.
const BRIGHTLINE = '0x8569462fa82f8e9ecbfaf6227bbf383d2c8a9b92';
// "Oceanic Freight" at an address that is not the pinned one: the classic invoice-redirect attack.
const IMPOSTOR = '0xD15ea5E000000000000000000000000000000BAD';

export type Step = 'auto' | 'impostor' | 'countersign';
const BILLS: { step: Step; payee: Record<string, string>; amount: string; memo: string }[] = [
  { step: 'auto', payee: { payeeId: 'pay_oceanic' }, amount: '0.02', memo: 'Freight, invoice' },
  { step: 'impostor', payee: { name: 'Oceanic Freight', address: IMPOSTOR }, amount: '0.04', memo: 'Freight, "updated bank details"' },
  { step: 'countersign', payee: { name: 'Brightline Media', address: BRIGHTLINE }, amount: '0.06', memo: 'Campaign creative' },
];

const DAILY_RUNS = Number(process.env.DEMO_DAILY_RUNS ?? 60);
const RUNS_PER_HOUR = Number(process.env.DEMO_RUNS_PER_HOUR ?? 6);

export function assertDemo() {
  if (!DEMO_ENABLED) throw new TwokeyError('not_found', 404, 'the public demo is off');
}

/** Mutations must come from our own pages: same-origin, plus a SameSite=Strict cookie. */
export async function assertSameOrigin(req: Request) {
  const h = await headers();
  const origin = req.headers.get('origin');
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!origin || !host || new URL(origin).host !== host) throw new TwokeyError('forbidden', 403, 'cross-site request refused');
}

export async function visitor(create: boolean): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(DEMO_COOKIE)?.value;
  if (v && /^[A-Za-z0-9_-]{16,32}$/.test(v)) return v;
  if (!create) return null;
  const id = randomBytes(15).toString('base64url');
  jar.set(DEMO_COOKIE, id, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 86_400 });
  return id;
}

// In memory, like the agent limit: one web instance.
const hits = new Map<string, number[]>();
function limited(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= RUNS_PER_HOUR) return true;
  recent.push(now);
  hits.set(key, recent);
  return false;
}

const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

async function runsToday(): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.orgId, demoCfg.orgId), eq(paymentIntents.agentId, DEMO_AGENT), gte(paymentIntents.createdAt, startOfUtcDay())));
  return Math.ceil((row?.n ?? 0) / BILLS.length);
}

/** The agent sends its three bills. Same visitor and run id give the same payments back. */
export async function runAgent(req: Request): Promise<{ run: string }> {
  assertDemo();
  await assertSameOrigin(req);
  const v = (await visitor(true))!;
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'local';
  if (limited(`ip:${ip}`) || limited(`v:${v}`)) throw new TwokeyError('rate_limited', 429, `${RUNS_PER_HOUR} runs an hour per visitor; try again later`);
  if ((await runsToday()) >= DAILY_RUNS) throw new TwokeyError('daily_cap', 429, 'today’s demo budget is spent; it resets at 00:00 UTC');

  const run = Date.now().toString(36);
  const d = await deps(demoCfg);
  for (const b of BILLS) {
    await requestPayment(d, {
      agentId: DEMO_AGENT,
      idempotencyKey: `demo:${v}:${run}:${b.step}`,
      body: { payee: b.payee, amount: b.amount, memo: `${b.memo} ${run.slice(-4).toUpperCase()}` },
    });
  }
  return { run };
}

export interface DemoItem {
  id: string;
  step: Step;
  payee: string | null;
  address: string | null;
  amount: string;
  memo: string | null;
  status: string;
  ruleId: string;
  failed: { id: string; detail: string }[];
  approval: { id: string; status: string; seal: string; canonical: string; expiresAt: string } | null;
  voidDetail: { amount_from?: string; amount_to?: string } | null;
  txHash: string | null;
  /** For a paid payment: seconds from the request (or from the countersignature) to final on Arc. */
  seconds: number | null;
}

export interface DemoState {
  enabled: boolean;
  run: string | null;
  items: DemoItem[];
  mandate: { version: number; perTx: string; daily: string; payees: { name: string; address: string }[]; treasury: string } | null;
  balance: string | null;
  runsLeftToday: number;
}

const stepOf = (key: string): Step => key.split(':')[3] as Step;
// Visitor ids are base64url, and `_` is a LIKE wildcard.
const keysOf = (v: string) => `demo:${v.replace(/[\\%_]/g, '\\$&')}:%`;

export async function demoState(): Promise<DemoState> {
  if (!DEMO_ENABLED) return { enabled: false, run: null, items: [], mandate: null, balance: null, runsLeftToday: 0 };
  const v = await visitor(false);
  const m = await getActiveMandate(db(), demoCfg.orgId);
  const bal = m ? await latestBalance(db(), m.source_wallet.circle_wallet_id) : null;
  const base = {
    enabled: true,
    mandate: m
      ? { version: m.version, perTx: m.limits.per_tx, daily: m.limits.daily, payees: m.payees.map((p) => ({ name: p.name, address: p.address })), treasury: m.source_wallet.address }
      : null,
    balance: bal?.usdc ?? null,
    runsLeftToday: Math.max(0, DAILY_RUNS - (await runsToday())),
  };
  if (!v) return { ...base, run: null, items: [] };

  const intents = await db()
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.orgId, demoCfg.orgId), eq(paymentIntents.agentId, DEMO_AGENT), like(paymentIntents.idempotencyKey, keysOf(v))))
    .orderBy(desc(paymentIntents.createdAt))
    .limit(BILLS.length);
  const run = intents[0]?.idempotencyKey.split(':')[2] ?? null;
  const mine = intents.filter((i) => i.idempotencyKey.split(':')[2] === run);
  const ids = mine.map((i) => i.id);
  const aps = ids.length ? await db().select().from(approvals).where(inArray(approvals.intentId, ids)).orderBy(desc(approvals.createdAt)) : [];
  const ats = ids.length ? await db().select().from(attempts).where(inArray(attempts.intentId, ids)).orderBy(desc(attempts.createdAt)) : [];

  const items = mine
    .map((i): DemoItem => {
      const a = aps.find((x) => x.intentId === i.id) ?? null;
      const at = ats.find((x) => x.intentId === i.id) ?? null;
      const from = i.approved && a?.decidedAt ? a.decidedAt : i.createdAt;
      return {
        id: i.id,
        step: stepOf(i.idempotencyKey),
        payee: i.payeeName,
        address: i.destinationAddress ?? ((i.payeeRef as { address?: string }).address ?? null),
        amount: i.amount,
        memo: i.memo,
        status: i.status,
        ruleId: i.ruleId,
        failed: (i.checks as { id: string; pass: boolean; detail: string }[]).filter((c) => !c.pass).map(({ id, detail }) => ({ id, detail })),
        approval: a ? { id: a.id, status: a.status, seal: a.seal, canonical: a.boundTermsCanonical, expiresAt: a.expiresAt.toISOString() } : null,
        voidDetail: (a?.voidDetail as DemoItem['voidDetail']) ?? null,
        txHash: at?.txHash ?? null,
        seconds: i.status === 'PAID' ? Math.max(0, (i.updatedAt.getTime() - from.getTime()) / 1000) : null,
      };
    })
    .sort((x, y) => BILLS.findIndex((b) => b.step === x.step) - BILLS.findIndex((b) => b.step === y.step));
  return { ...base, run, items };
}

/** A visitor may only act on payments their own run caused. */
async function ownIntent(req: Request, paymentId: unknown) {
  assertDemo();
  await assertSameOrigin(req);
  const v = await visitor(false);
  if (!v || typeof paymentId !== 'string') throw new TwokeyError('not_found', 404, 'payment not found');
  const [i] = await db()
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.id, paymentId), eq(paymentIntents.orgId, demoCfg.orgId), like(paymentIntents.idempotencyKey, keysOf(v))));
  if (!i) throw new TwokeyError('not_found', 404, 'payment not found');
  const [a] = await db().select().from(approvals).where(eq(approvals.intentId, i.id)).orderBy(desc(approvals.createdAt)).limit(1);
  return { intent: i, approval: a ?? null };
}

export async function countersign(req: Request, body: { paymentId?: unknown; seal?: unknown }) {
  const { approval } = await ownIntent(req, body.paymentId);
  if (!approval || typeof body.seal !== 'string') throw new TwokeyError('invalid_request', 400, 'body must be { paymentId, seal }');
  const r = await decideApproval(await deps(demoCfg), { approvalId: approval.id, decision: 'approve', seal: body.seal, by: VISITOR_BY, via: 'public-demo' });
  return { status: r.approval.status, ...(r.note ? { note: r.note } : {}) };
}

export async function refuse(req: Request, body: { paymentId?: unknown }) {
  const { approval } = await ownIntent(req, body.paymentId);
  if (!approval) throw new TwokeyError('not_found', 404, 'no approval for this payment');
  const r = await decideApproval(await deps(demoCfg), { approvalId: approval.id, decision: 'reject', reason: 'Refused in the public demo', by: VISITOR_BY, via: 'public-demo' });
  return { status: r.approval.status };
}

/** The agent re-rounds the amount by one cent after the visitor saw or signed it. */
export async function drift(req: Request, body: { paymentId?: unknown }) {
  const { intent } = await ownIntent(req, body.paymentId);
  return driftDemo(await deps(demoCfg), intent.id, '0.01');
}
