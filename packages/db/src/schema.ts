import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const usdc = (name: string) => numeric(name, { precision: 20, scale: 6 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

export const mandates = pgTable(
  'mandates',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    version: integer('version').notNull(),
    document: jsonb('document').notNull(),
    documentHash: text('document_hash').notNull(),
    status: text('status', { enum: ['ACTIVE', 'SUPERSEDED'] }).notNull(),
    activatedAt: ts('activated_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('mandates_org_version').on(t.orgId, t.version),
    uniqueIndex('mandates_one_active').on(t.orgId).where(sql`${t.status} = 'ACTIVE'`),
  ],
);

export const payees = pgTable(
  'payees',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    payeeId: text('payee_id').notNull(),
    name: text('name').notNull(),
    network: text('network').notNull(),
    address: text('address').notNull(),
    fingerprint: text('fingerprint').notNull(),
    mandateVersion: integer('mandate_version').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('payees_org_payee_version').on(t.orgId, t.payeeId, t.mandateVersion)],
);

export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  agentId: text('agent_id').notNull().unique(),
  name: text('name').notNull(),
  apiKeyHash: text('api_key_hash').notNull().unique(),
  status: text('status', { enum: ['ACTIVE', 'REVOKED'] }).notNull(),
  createdAt: createdAt(),
});

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    agentId: text('agent_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    payeeRef: jsonb('payee_ref').notNull(),
    resolvedPayeeId: text('resolved_payee_id'),
    payeeName: text('payee_name'),
    destinationNetwork: text('destination_network'),
    destinationAddress: text('destination_address'),
    amount: usdc('amount').notNull(),
    memo: text('memo'),
    lane: text('lane').notNull(),
    ruleId: text('rule_id').notNull(),
    checks: jsonb('checks').notNull(),
    outcome: text('outcome').notNull(),
    status: text('status').notNull(),
    /** True once a human approval let it run; such payments don't count toward the daily auto cap. */
    approved: boolean('approved').notNull().default(false),
    mandateVersion: integer('mandate_version'),
    stateSnapshot: jsonb('state_snapshot').notNull(),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('intents_agent_idem').on(t.agentId, t.idempotencyKey), index('intents_status').on(t.status)],
);

export const approvals = pgTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    intentId: text('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    seal: text('seal').notNull().unique(),
    boundTerms: jsonb('bound_terms').notNull(),
    boundTermsCanonical: text('bound_terms_canonical').notNull(),
    status: text('status', { enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'VOIDED', 'CONSUMED'] }).notNull(),
    expiresAt: ts('expires_at').notNull(),
    decidedBy: text('decided_by'),
    decidedVia: text('decided_via', { enum: ['dashboard', 'telegram'] }),
    decidedAt: ts('decided_at'),
    rejectReason: text('reject_reason'),
    voidReason: text('void_reason'),
    voidDetail: jsonb('void_detail'),
    consumedAt: ts('consumed_at'),
    nonce: text('nonce').notNull(),
    telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('approvals_one_open_per_intent').on(t.intentId).where(sql`${t.status} in ('PENDING','APPROVED')`)],
);

export const attempts = pgTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    intentId: text('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    circleIdempotencyKey: uuid('circle_idempotency_key').notNull().unique(),
    circleTransactionId: text('circle_transaction_id').unique(),
    state: text('state').notNull(),
    txHash: text('tx_hash'),
    feePaid: usdc('fee_paid'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    submittedAt: ts('submitted_at'),
    lastPolledAt: ts('last_polled_at'),
    pollCount: integer('poll_count').notNull().default(0),
    reconcileCount: integer('reconcile_count').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('attempts_one_live_per_intent')
      .on(t.intentId)
      .where(sql`${t.state} not in ('FAILED','DENIED','CANCELLED')`),
  ],
);

export const balanceSnapshots = pgTable(
  'balance_snapshots',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    walletId: text('wallet_id').notNull(),
    usdcAmount: usdc('usdc_amount').notNull(),
    feeEstimate: usdc('fee_estimate'),
    takenAt: ts('taken_at').notNull(),
    source: text('source', { enum: ['poll', 'post_tx', 'webhook', 'boot'] }).notNull(),
  },
  (t) => [index('balance_wallet_taken').on(t.walletId, t.takenAt.desc())],
);

// The hash chain is per org, so seq is unique per org: the key is (org_id, seq).
export const auditLog = pgTable('audit_log', {
  seq: bigint('seq', { mode: 'number' }).notNull(),
  orgId: text('org_id').notNull(),
  at: ts('at').notNull(),
  actorType: text('actor_type', { enum: ['agent', 'user', 'system', 'circle'] }).notNull(),
  actorId: text('actor_id').notNull(),
  verb: text('verb').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  data: jsonb('data').notNull(),
  prevHash: text('prev_hash').notNull(),
  entryHash: text('entry_hash').notNull().unique(),
}, (t) => [primaryKey({ columns: [t.orgId, t.seq] })]);

export const webhookEvents = pgTable('webhook_events', {
  notificationId: text('notification_id').primaryKey(),
  notificationType: text('notification_type').notNull(),
  payload: jsonb('payload').notNull(),
  rawBody: text('raw_body').notNull(),
  signature: text('signature'),
  keyId: text('key_id'),
  signatureOk: boolean('signature_ok'),
  receivedAt: ts('received_at').notNull().defaultNow(),
  processedAt: ts('processed_at'),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['OWNER'] }).notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
  idHash: text('id_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
});

export const telegramLinks = pgTable('telegram_links', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  chatId: text('chat_id').notNull().unique(),
  createdAt: createdAt(),
});
