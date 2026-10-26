import type { PaymentRequest, PaymentResponse } from '@twokey-arc/contracts';

export type { PaymentResponse } from '@twokey-arc/contracts';

export interface PayAction {
  type: 'PAY';
  payee: { payeeId?: string; address?: string; name?: string };
  amount: string;
  memo?: string;
}

export class TwokeyApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'TwokeyApiError';
  }
}

export interface TwokeyClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

const FINAL = new Set(['PAID', 'FAILED', 'BLOCKED', 'REJECTED', 'EXPIRED', 'VOIDED', 'CANCELLED', 'NEEDS_HUMAN']);

/**
 * The agent side of Twokey. The agent holds only a Twokey agent key: no wallet credentials,
 * no Circle wallet ids. It asks; Twokey decides executed, pending_approval or blocked.
 */
export function createTwokey(opts: TwokeyClientOptions) {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, '');

  async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await f(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details?: unknown } };
    if (!res.ok) throw new TwokeyApiError(res.status, json.error?.code ?? 'http_error', json.error?.message ?? res.statusText, json.error?.details);
    return json as T;
  }

  const getPayment = (paymentId: string) => request<PaymentResponse>('GET', `/api/v1/payments/${encodeURIComponent(paymentId)}`);

  const agent = {
    /** Request a payment. Use one stable idempotencyKey per invoice; retries return the same payment. */
    guard(action: PayAction, meta: { agentId: string; idempotencyKey: string }): Promise<PaymentResponse> {
      const body: PaymentRequest = { payee: action.payee, amount: action.amount, ...(action.memo ? { memo: action.memo } : {}) };
      return request('POST', '/api/v1/payments', body, { 'idempotency-key': meta.idempotencyKey, 'x-twokey-agent': meta.agentId });
    },
    getPayment,
    getMandate: () => request<Record<string, unknown>>('GET', '/api/v1/mandate'),
    cancel: (paymentId: string) => request<PaymentResponse>('POST', `/api/v1/payments/${encodeURIComponent(paymentId)}/cancel`, {}),
    /** Polls until the payment reaches a final status (or `until` matches), or times out. */
    async waitFor(
      paymentId: string,
      o: { timeoutMs?: number; intervalMs?: number; until?: (p: PaymentResponse) => boolean } = {},
    ): Promise<PaymentResponse> {
      const deadline = Date.now() + (o.timeoutMs ?? 60_000);
      for (;;) {
        const p = await getPayment(paymentId);
        if (o.until ? o.until(p) : FINAL.has(p.status)) return p;
        if (Date.now() > deadline) throw new TwokeyApiError(408, 'timeout', `payment ${paymentId} is still ${p.status}`);
        await new Promise((r) => setTimeout(r, o.intervalMs ?? 750));
      }
    },
  };

  return { agent };
}

export interface TwokeyPayToolInput {
  payee_id?: string;
  address?: string;
  payee_name?: string;
  amount: string;
  memo?: string;
  idempotency_key: string;
}

/**
 * Handlers for the three tools an LLM (or MCP client) gets: twokey_pay, twokey_get_payment, twokey_get_mandate.
 * The model sees only these; never Circle credentials or wallet ids.
 */
export function twokeyTools(agent: ReturnType<typeof createTwokey>['agent'], agentId: string) {
  return {
    twokey_pay: (i: TwokeyPayToolInput) =>
      agent.guard(
        {
          type: 'PAY',
          payee: {
            ...(i.payee_id ? { payeeId: i.payee_id } : {}),
            ...(i.address ? { address: i.address } : {}),
            ...(i.payee_name ? { name: i.payee_name } : {}),
          },
          amount: i.amount,
          ...(i.memo ? { memo: i.memo } : {}),
        },
        { agentId, idempotencyKey: i.idempotency_key },
      ),
    twokey_get_payment: (i: { payment_id: string }) => agent.getPayment(i.payment_id),
    twokey_get_mandate: () => agent.getMandate(),
  };
}
