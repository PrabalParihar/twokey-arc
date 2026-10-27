# Verification log

PRD Appendix B listed eight [VERIFY] items. This is what has been checked and how.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | `requestTestnetTokens` accepts `ARC-TESTNET` | **Typed: yes.** `TestnetBlockchain` includes `ARC-TESTNET` in SDK 10.8.1. Live: pending the first `pnpm circle:setup`. | SDK `.d.ts`; `scripts/circle-setup.ts` falls back to faucet.circle.com |
| 2 | `estimateTransferFee` field name and fee units | **Field: `amount: string[]`** (SDK 10.8.1 `.d.ts`; the circlefin skill's `amounts` is the REST name). Units: `networkFee` is a decimal in the native unit, which on Arc is USDC. It is converted to 6 dp and rounded up. Live value pending. | `packages/circle/src/transfers.ts`, `units.ts` |
| 3 | Replaying `createTransaction` with the same `idempotencyKey` returns the original transaction | Pending live. `pnpm chaos` scenario (c) replays the same key after Circle accepted it and asserts exactly one transfer for the `refId`. | `scripts/chaos-retry.ts` |
| 4 | Typical Arc Testnet transfer fee | Pending live (`pnpm circle:smoke` prints it). `DEFAULT_FEE_ESTIMATE_USDC=0.010000` is used until then. | |
| 5 | App Kit chain name for Arc mainnet | Out of scope (M2). | |
| 6 | Contract-execution method name | **Confirmed:** `createContractExecutionTransaction` exists in SDK 10.8.1 (M2). | SDK `.d.ts` |
| 7 | Circle-side limits for developer-controlled wallets | Not found in the SDK surface. Documented spending policies are for mainnet Agent Wallets. | |
| 8 | Webhook helpers | **Confirmed:** `getNotificationSignature(keyId)` returns `{ id, algorithm, publicKey }`. Verification is ECDSA SHA-256 over the raw body. The key encoding still needs checking on a live webhook. | `packages/circle/src/webhooks.ts` |

Also found while building:
- The SDK's `TransactionState` has no `WAITING`.
- `getTransaction` supports `waitForTxHash` with an `AbortSignal`. Twokey polls on its own schedule instead, so it can record each state in the audit log.

## Live runs
Each `pnpm demo:run` writes `docs/demo-runs/<timestamp>.json` with its tx hashes.

## Local end-to-end over HTTP (simulated Circle), Oct 27, 2026
Before the Circle keys existed, the full stack ran locally:
- `next start` (production build)
- the real executor wiring (`apps/executor/src/run.ts`: pg-boss jobs, sweeper, balance refresh)
- Postgres
- a simulated `CirclePort` (`pnpm sim`)

Nothing touched Arc, and none of this counts as evidence of Arc transactions. What was exercised:
- **Demo agent:** INV-88213 `executed` → PAID; BM-7 `pending_approval`; INV-88240 `blocked` (INV-PAYEE-PINNED); HC-2210 `pending_approval`.
- **`demo:run` (`DEMO_RUN_SIMULATED=1`):** 7/7 steps, 3 consecutive passes on a clean database.
  - What each run covers: owner login, CSRF, stale seal 409, approve, drift void inside the 5 s grace window, idempotent replay, audit verify, and a balance delta equal to amount + fee.
  - After about 6 runs in one IST day the 1.50 daily auto cap is spent, and step 1 correctly turns into `pending_approval`.
- **MCP server:**
  - stdio: lists the three tools; `twokey_get_mandate` hides wallet ids; `twokey_pay` executes; a 7-dp amount is rejected.
  - Streamable HTTP: 401 without an agent key; `tools/list` works with one.
- **Dashboard (browser):**
  - login form;
  - a 400 ms press does **not** approve ("Keep holding"), and the fill is 0.5 at 600 ms;
  - a full hold approves → PAID;
  - Enter on the focused button approves → PAID;
  - Reject needs a reason;
  - drift then hold → "the amount changed from 0.70 to 1.20. Nothing was sent.";
  - Verify chain: intact, 142 entries;
  - mandate and approval pages render;
  - no horizontal overflow at 375 px.
- **Sessions:** a session survives a web restart; logout without CSRF → 403; a logged-out token → 401.

Bugs found and fixed by these runs:
- The agent rate limit counted status polling. It now counts only payment requests and cancels; there's a test.
- The approval panel jumped to the next pending item after a decision.
- The mobile grid overflowed at 375 px.
- The web service had no pre-deploy migration. Production returned 500s until the schema existed; `preDeployCommand: pnpm db:migrate` fixes it.
- Error logs repeated SQL params. They now log the cause only.
