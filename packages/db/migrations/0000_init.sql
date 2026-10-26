CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_agent_id_unique" UNIQUE("agent_id"),
	CONSTRAINT "agents_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"seal" text NOT NULL,
	"bound_terms" jsonb NOT NULL,
	"bound_terms_canonical" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by" text,
	"decided_via" text,
	"decided_at" timestamp with time zone,
	"reject_reason" text,
	"void_reason" text,
	"void_detail" jsonb,
	"consumed_at" timestamp with time zone,
	"nonce" text NOT NULL,
	"telegram_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_seal_unique" UNIQUE("seal")
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"circle_idempotency_key" uuid NOT NULL,
	"circle_transaction_id" text,
	"state" text NOT NULL,
	"tx_hash" text,
	"fee_paid" numeric(20, 6),
	"error_code" text,
	"error_message" text,
	"submitted_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"reconcile_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempts_circle_idempotency_key_unique" UNIQUE("circle_idempotency_key"),
	CONSTRAINT "attempts_circle_transaction_id_unique" UNIQUE("circle_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"verb" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"entry_hash" text NOT NULL,
	CONSTRAINT "audit_log_entry_hash_unique" UNIQUE("entry_hash")
);
--> statement-breakpoint
CREATE TABLE "balance_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	"usdc_amount" numeric(20, 6) NOT NULL,
	"fee_estimate" numeric(20, 6),
	"taken_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"document_hash" text NOT NULL,
	"status" text NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payees" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"payee_id" text NOT NULL,
	"name" text NOT NULL,
	"network" text NOT NULL,
	"address" text NOT NULL,
	"fingerprint" text NOT NULL,
	"mandate_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"payee_ref" jsonb NOT NULL,
	"resolved_payee_id" text,
	"payee_name" text,
	"destination_network" text,
	"destination_address" text,
	"amount" numeric(20, 6) NOT NULL,
	"memo" text,
	"lane" text NOT NULL,
	"rule_id" text NOT NULL,
	"checks" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"status" text NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"mandate_version" integer,
	"state_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"csrf_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_links_chat_id_unique" UNIQUE("chat_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"notification_id" text PRIMARY KEY NOT NULL,
	"notification_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"raw_body" text NOT NULL,
	"signature" text,
	"key_id" text,
	"signature_ok" boolean,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_one_open_per_intent" ON "approvals" USING btree ("intent_id") WHERE "approvals"."status" in ('PENDING','APPROVED');--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_one_live_per_intent" ON "attempts" USING btree ("intent_id") WHERE "attempts"."state" not in ('FAILED','DENIED','CANCELLED');--> statement-breakpoint
CREATE INDEX "balance_wallet_taken" ON "balance_snapshots" USING btree ("wallet_id","taken_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "mandates_org_version" ON "mandates" USING btree ("org_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "mandates_one_active" ON "mandates" USING btree ("org_id") WHERE "mandates"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "payees_org_payee_version" ON "payees" USING btree ("org_id","payee_id","mandate_version");--> statement-breakpoint
CREATE UNIQUE INDEX "intents_agent_idem" ON "payment_intents" USING btree ("agent_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "intents_status" ON "payment_intents" USING btree ("status");