CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"network" text NOT NULL,
	"wallet_id" text,
	"wallet_address" text,
	"faucet_requested_at" timestamp with time zone,
	"provision_error" text,
	"telegram_link_code" text,
	"telegram_skipped" boolean DEFAULT false NOT NULL,
	"signup_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_telegram_link_code_unique" UNIQUE("telegram_link_code")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "org_id" text;