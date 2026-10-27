-- The audit hash chain is per org, so seq is unique per org, not globally.
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_pkey";--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_seq_pk" PRIMARY KEY("org_id","seq");
