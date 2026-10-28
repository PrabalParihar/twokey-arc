import { z } from 'zod';

const amount = z
  .string()
  .regex(/^[0-9]+(\.[0-9]{1,6})?$/, 'USDC amount with at most 6 decimals, e.g. "0.25"');
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, '0x-prefixed 20-byte address');

/** Body of POST /api/v1/payments. The Idempotency-Key travels as a header. */
export const PaymentRequest = z
  .object({
    payee: z
      .object({
        payeeId: z.string().min(1).max(64).optional(),
        address: z.string().max(64).optional(),
        name: z.string().max(120).optional(),
      })
      .strict(),
    amount,
    memo: z.string().max(140).optional(),
    network: z.enum(['ARC-TESTNET', 'ARC']).optional(),
  })
  .strict();
export type PaymentRequest = z.infer<typeof PaymentRequest>;

export const Lane = z.enum(['LOWERS_RISK', 'INSIDE_MANDATE', 'ADDS_RISK', 'BREAKS_RULE']);
export const Outcome = z.enum(['executed', 'pending_approval', 'blocked']);
export const IntentStatus = z.enum([
  'RECEIVED',
  'BLOCKED',
  'QUEUED',
  'AWAITING_APPROVAL',
  'REJECTED',
  'EXPIRED',
  'VOIDED',
  'CANCELLED',
  'SUBMITTED',
  'PAID',
  'FAILED',
  'UNCONFIRMED',
  'NEEDS_HUMAN',
]);
export type IntentStatus = z.infer<typeof IntentStatus>;

export const Check = z.object({ id: z.string(), pass: z.boolean(), detail: z.string() });

export const PaymentResponse = z.object({
  paymentId: z.string(),
  outcome: Outcome,
  lane: Lane,
  ruleId: z.string(),
  checks: z.array(Check),
  status: IntentStatus,
  amount: z.string(),
  payee: z.object({ payeeId: z.string().nullable(), name: z.string().nullable(), address: z.string().nullable() }),
  memo: z.string().nullable(),
  approval: z.object({ id: z.string(), status: z.string(), expiresAt: z.string() }).optional(),
  circleTransactionId: z.string().optional(),
  txHash: z.string().optional(),
  explorerUrl: z.string().optional(),
  createdAt: z.string(),
});
export type PaymentResponse = z.infer<typeof PaymentResponse>;

export const ApproveBody = z.object({ seal: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict();
export const RejectBody = z.object({ reason: z.string().trim().min(1).max(280) }).strict();

const mandatePayee = z
  .object({
    payee_id: z.string().regex(/^pay_[a-z0-9_]+$/),
    name: z.string().min(1).max(120),
    network: z.string(),
    address: evmAddress,
    fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    per_tx_override: amount.nullable(),
  })
  .strict();

export const MandateDocument = z
  .object({
    v: z.literal(1),
    mandate_id: z.string(),
    version: z.number().int().positive(),
    network: z.string(),
    chain_id: z.number().int(),
    token: z.object({ symbol: z.literal('USDC'), address: evmAddress, decimals: z.literal(6) }).strict(),
    source_wallet: z.object({ circle_wallet_id: z.string(), address: evmAddress }).strict(),
    timezone: z.string(),
    limits: z.object({ per_tx: amount, daily: amount, hard_max_per_tx: amount, min_balance_after: amount }).strict(),
    payees: z.array(mandatePayee),
    valid_from: z.iso.datetime(),
    expires_at: z.iso.datetime(),
    approval: z.object({ ttl_minutes: z.number().int().min(1).max(1440), telegram: z.boolean() }).strict(),
    signed_by: z.string(),
    signed_at: z.iso.datetime(),
    signature: z.string(),
  })
  .strict();
export type MandateDocument = z.infer<typeof MandateDocument>;

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

/** The tool an LLM calls (PRD §14.2). Shared by the demo agent and the MCP server. */
export const TWOKEY_PAY_TOOL = {
  name: 'twokey_pay',
  description:
    "Request a USDC payment on Arc through Twokey. You never move money directly. Twokey decides: 'executed' (paid inside the mandate), 'pending_approval' (a human must approve; tell the user and continue other work), or 'blocked' (refused; do not retry with changed details). Use one stable idempotency_key per invoice.",
  input_schema: {
    type: 'object',
    properties: {
      payee_id: { type: 'string', description: 'Known payee id from twokey_get_mandate, if the payee is known' },
      address: { type: 'string', description: '0x address, only for a payee not in the mandate' },
      payee_name: { type: 'string' },
      amount: { type: 'string', pattern: '^[0-9]+(\\.[0-9]{1,6})?$', description: 'USDC, e.g. "25.00"' },
      memo: { type: 'string', maxLength: 140 },
      idempotency_key: { type: 'string', minLength: 8 },
    },
    required: ['amount', 'idempotency_key'],
  },
} as const;

export const TwokeyPayInput = z.object({
  payee_id: z.string().optional(),
  address: z.string().optional(),
  payee_name: z.string().optional(),
  amount,
  memo: z.string().max(140).optional(),
  idempotency_key: z.string().min(8),
});
export type TwokeyPayInput = z.infer<typeof TwokeyPayInput>;
