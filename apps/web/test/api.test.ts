import { hash } from '@node-rs/argon2';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHarness, type Harness } from '../../../packages/core/test/harness';
import { assertNoCircleSecrets } from '../lib/boot';

// A cookie jar standing in for next/headers, so route handlers run as they would in Next.
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string) => void jar.delete(n),
  }),
}));

let h: Harness;
type Ctx = { params: Promise<{ id: string }> };
let routes: {
  payments: typeof import('../app/api/v1/payments/route');
  approve: typeof import('../app/api/v1/approvals/[id]/approve/route');
  approval: typeof import('../app/api/v1/approvals/[id]/route');
  approvals: typeof import('../app/api/v1/approvals/route');
  login: typeof import('../app/api/auth/login/route');
  verify: typeof import('../app/api/v1/audit/verify/route');
  circleHook: typeof import('../app/api/circle/webhook/route');
  telegramHook: typeof import('../app/api/telegram/webhook/route');
};

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://test${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  h = await createHarness();
  Object.assign(process.env, {
    DATABASE_URL: h.url,
    TWOKEY_ORG_ID: 'org_test',
    AGENT_KEY_PEPPER: 'test-pepper',
    OWNER_EMAIL: 'owner@twokey.test',
    OWNER_PASSWORD_HASH: await hash('correct horse battery', { algorithm: 2 }),
    OWNER_NAME: 'Prabal',
    DEMO_MODE: 'true',
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_WEBHOOK_SECRET: 'tg-secret',
    TELEGRAM_APPROVER_CHAT_ID: '42',
  });
  routes = {
    payments: await import('../app/api/v1/payments/route'),
    approve: await import('../app/api/v1/approvals/[id]/approve/route'),
    approval: await import('../app/api/v1/approvals/[id]/route'),
    approvals: await import('../app/api/v1/approvals/route'),
    login: await import('../app/api/auth/login/route'),
    verify: await import('../app/api/v1/audit/verify/route'),
    circleHook: await import('../app/api/circle/webhook/route'),
    telegramHook: await import('../app/api/telegram/webhook/route'),
  };
});
afterAll(async () => h?.close());

const agentHeaders = () => ({ authorization: `Bearer ${h.agentKey}`, 'idempotency-key': `inv-${Math.random().toString(36).slice(2)}` });

describe('boot', () => {
  it('web refuses to start with Circle credentials in its environment', () => {
    expect(() => assertNoCircleSecrets({ CIRCLE_API_KEY: 'TEST_API_KEY:x' })).toThrow(/must not hold Circle credentials/);
    expect(() => assertNoCircleSecrets({ CIRCLE_ENTITY_SECRET: 'x' })).toThrow(/CIRCLE_ENTITY_SECRET/);
    expect(() => assertNoCircleSecrets({})).not.toThrow();
    expect(process.env.CIRCLE_API_KEY).toBeUndefined();
  });
});

describe('agent API', () => {
  it('requires an agent key', async () => {
    const r = await routes.payments.POST(req('POST', '/api/v1/payments', { payee: { payeeId: 'pay_oceanic' }, amount: '1.00' }, { 'idempotency-key': 'inv-12345678' }));
    expect(r.status).toBe(401);
  });

  it('accepts a request (202) and replays it (200) with the same Idempotency-Key', async () => {
    const headers = agentHeaders();
    const body = { payee: { payeeId: 'pay_oceanic' }, amount: '1.00', memo: 'INV-1' };
    const first = await routes.payments.POST(req('POST', '/api/v1/payments', body, headers));
    expect(first.status).toBe(202);
    const a = await first.json();
    expect(a).toMatchObject({ outcome: 'executed', ruleId: 'R-WM-PAY' });
    const again = await routes.payments.POST(req('POST', '/api/v1/payments', body, headers));
    expect(again.status).toBe(200);
    expect((await again.json()).paymentId).toBe(a.paymentId);
  });
});

describe('the second key belongs to a person', () => {
  let approvalId = '';
  beforeAll(async () => {
    const r = await routes.payments.POST(req('POST', '/api/v1/payments', { payee: { address: '0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0', name: 'Brightline Media' }, amount: '75.00' }, agentHeaders()));
    approvalId = (await r.json()).approval.id;
  });

  it('an agent key cannot approve, even its own request', async () => {
    jar.clear();
    const r = await routes.approve.POST(req('POST', `/api/v1/approvals/${approvalId}/approve`, { seal: `sha256:${'0'.repeat(64)}` }, { authorization: `Bearer ${h.agentKey}` }), ctx(approvalId));
    expect(r.status).toBe(401);
  });

  it('owner routes reject agent keys', async () => {
    jar.clear();
    expect((await routes.approvals.GET(req('GET', '/api/v1/approvals', undefined, { authorization: `Bearer ${h.agentKey}` }))).status).toBe(401);
  });

  it('wrong password is refused and audited', async () => {
    const r = await routes.login.POST(req('POST', '/api/auth/login', { email: 'owner@twokey.test', password: 'nope' }));
    expect(r.status).toBe(401);
  });

  it('needs the CSRF header, then the exact seal (409 otherwise), then approves', async () => {
    const login = await routes.login.POST(req('POST', '/api/auth/login', { email: 'owner@twokey.test', password: 'correct horse battery' }));
    expect(login.status).toBe(200);
    const { csrf } = await login.json();
    expect(jar.get('tk_session')).toBeTruthy();

    const { seal } = await (await routes.approval.GET(req('GET', `/api/v1/approvals/${approvalId}`), ctx(approvalId))).json();
    const noCsrf = await routes.approve.POST(req('POST', `/api/v1/approvals/${approvalId}/approve`, { seal }), ctx(approvalId));
    expect(noCsrf.status).toBe(403);
    const wrong = await routes.approve.POST(req('POST', `/api/v1/approvals/${approvalId}/approve`, { seal: `sha256:${'1'.repeat(64)}` }, { 'x-csrf-token': csrf }), ctx(approvalId));
    expect(wrong.status).toBe(409);
    expect((await wrong.json()).error.code).toBe('seal_mismatch');
    const ok = await routes.approve.POST(req('POST', `/api/v1/approvals/${approvalId}/approve`, { seal }, { 'x-csrf-token': csrf }), ctx(approvalId));
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe('APPROVED');
  });

  it('the audit chain verifies (public in demo mode)', async () => {
    jar.clear();
    const v = await (await routes.verify.GET(req('GET', '/api/v1/audit/verify'))).json();
    expect(v).toMatchObject({ ok: true });
  });
});

describe('webhooks', () => {
  it('stores a Circle notification once and leaves verification to the executor', async () => {
    const body = { subscriptionId: 's', notificationId: 'n-1', notificationType: 'transactions.outbound', notification: { id: 'ctx_1' }, timestamp: 't', version: 2 };
    const first = await (await routes.circleHook.POST(req('POST', '/api/circle/webhook', body, { 'x-circle-signature': 'sig', 'x-circle-key-id': 'k' }))).json();
    const second = await (await routes.circleHook.POST(req('POST', '/api/circle/webhook', body))).json();
    expect(first).toEqual({ ok: true, duplicate: false });
    expect(second).toEqual({ ok: true, duplicate: true });
  });

  it('Telegram callbacks need the secret header', async () => {
    const r = await routes.telegramHook.POST(req('POST', '/api/telegram/webhook', { callback_query: { id: '1', data: 'x' } }, { 'x-telegram-bot-api-secret-token': 'wrong' }));
    expect(r.status).toBe(401);
  });
});

describe('rate limit', () => {
  it('counts payment requests, not status reads', async () => {
    const r = await routes.payments.POST(req('POST', '/api/v1/payments', { payee: { payeeId: 'pay_oceanic' }, amount: '0.01' }, agentHeaders()));
    const { paymentId } = await r.json();
    const { GET } = await import('../app/api/v1/payments/[id]/route');
    for (let i = 0; i < 40; i++) {
      const g = await GET(req('GET', `/api/v1/payments/${paymentId}`, undefined, { authorization: `Bearer ${h.agentKey}` }), ctx(paymentId));
      expect(g.status).toBe(200);
    }
    process.env.AGENT_RATE_PER_MIN = '3';
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await routes.payments.POST(req('POST', '/api/v1/payments', { payee: { payeeId: 'pay_oceanic' }, amount: '0.01' }, agentHeaders()))).status);
    delete process.env.AGENT_RATE_PER_MIN;
    expect(codes.at(-1)).toBe(429);
  });
});
