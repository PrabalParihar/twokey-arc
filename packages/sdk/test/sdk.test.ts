import { describe, expect, it } from 'vitest';
import { createTwokey, TwokeyApiError } from '../src';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createTwokey', () => {
  it('sends the agent key, idempotency key and body', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const { agent } = createTwokey({
      baseUrl: 'https://twokey.test/',
      apiKey: 'tk_agent_x',
      fetch: async (url, init) => {
        seen.push({ url: String(url), init: init! });
        return reply(202, { paymentId: 'pi_1', outcome: 'executed', status: 'QUEUED' });
      },
    });
    const r = await agent.guard({ type: 'PAY', payee: { payeeId: 'pay_oceanic' }, amount: '0.25', memo: 'INV-88213' }, { agentId: 'ap-agent', idempotencyKey: 'INV-88213' });
    expect(r.outcome).toBe('executed');
    expect(seen[0]!.url).toBe('https://twokey.test/api/v1/payments');
    const h = seen[0]!.init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer tk_agent_x');
    expect(h['idempotency-key']).toBe('INV-88213');
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ payee: { payeeId: 'pay_oceanic' }, amount: '0.25', memo: 'INV-88213' });
  });

  it('surfaces API errors with their code', async () => {
    const { agent } = createTwokey({ baseUrl: 'https://t', apiKey: 'k', fetch: async () => reply(409, { error: { code: 'idempotency_key_reused', message: 'nope' } }) });
    const err = await agent.guard({ type: 'PAY', payee: {}, amount: '1' }, { agentId: 'a', idempotencyKey: 'k1234567' }).catch((e) => e);
    expect(err).toBeInstanceOf(TwokeyApiError);
    expect(err).toMatchObject({ status: 409, code: 'idempotency_key_reused' });
  });

  it('waitFor polls until a final status', async () => {
    let n = 0;
    const { agent } = createTwokey({
      baseUrl: 'https://t',
      apiKey: 'k',
      fetch: async () => reply(200, { paymentId: 'pi_1', status: ++n < 3 ? 'SUBMITTED' : 'PAID' }),
    });
    expect((await agent.waitFor('pi_1', { intervalMs: 1 })).status).toBe('PAID');
    expect(n).toBe(3);
  });

  it('waitFor times out', async () => {
    const { agent } = createTwokey({ baseUrl: 'https://t', apiKey: 'k', fetch: async () => reply(200, { status: 'SUBMITTED' }) });
    await expect(agent.waitFor('pi_1', { intervalMs: 1, timeoutMs: 5 })).rejects.toMatchObject({ code: 'timeout' });
  });
});
