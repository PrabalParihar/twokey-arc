# Threat model (spike)

| Threat | Mitigation | Where |
|---|---|---|
| Injected "vendor wallet changed" email | `INV-PAYEE-PINNED`: a known payee at a new address is blocked. Changing an address is a mandate change that adds risk. | `packages/policy/src/classify.ts` |
| Agent re-rounds the amount after approval | The seal is rebuilt from the intent at execute time. Any drift voids it with `terms_changed`. | `packages/core/src/executor.ts`, `approvals.ts` |
| Approver sees one thing and approves another | The client posts the seal it displayed; the server requires equality (409). Telegram carries 12 hex characters of it and the server checks them against the full seal. | `decideApproval` |
| Agent approves its own request | Approve routes need an owner session + CSRF. Agent keys are never accepted there (tested). | `apps/web/app/api/v1/approvals/[id]/approve` |
| Agent retries after a timeout | `unique(agent_id, idempotency_key)` + `request_hash`. Circle key written ahead and reused on every retry. | `payments.ts`, `executor.ts` |
| Concurrent auto payments break the daily cap | Per-org advisory lock at request and at execute, plus re-classification. | `state.ts`, `executor.ts` |
| Leaked agent key | It can only *request*. Out-of-mandate payments still need the owner. Keys are hashed and revocable, and there's a 30 requests/min limit. | `auth.ts`, `lib/http.ts` |
| Leaked web server | No Circle credentials in it; boot fails if they're present. | `apps/web/lib/boot.ts` |
| Audit tampering | Hash chain + append-only trigger + `GET /api/v1/audit/verify` (reports the first broken row). | `packages/seal/src/audit.ts`, migration `0001` |
| Webhook spoofing | Stored, not trusted. The executor verifies the ECDSA signature with Circle's key, dedupes on `notificationId`, and only nudges a re-poll of state from Circle. | `process-webhook.ts` |
| Telegram spoofing | Secret header + only the linked approver chat can decide; a per-message approve cap (`TELEGRAM_MAX_APPROVE_USDC`). | `api/telegram/webhook` |
| Prompt injection through memo/payee text | Policy never reads free text. Names can only *block* (pin), never resolve to an address. | `classify.ts` |
| Secrets in git or logs | `.env*`, `*.pem` and recovery files are git-ignored. pino redacts. Scripts write secrets to `.env` instead of printing them. | `.gitignore`, `apps/executor/src/main.ts` |
