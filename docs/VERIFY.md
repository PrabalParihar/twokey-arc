# Verification log

PRD Appendix B listed eight [VERIFY] items. This is what has been checked and how.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | `requestTestnetTokens` accepts `ARC-TESTNET` | **Typed yes; live: 403 Forbidden** for this account. The treasury was funded through https://faucet.circle.com (20 USDC). | `pnpm circle:setup` output, Oct 27 |
| 2 | `estimateTransferFee` field name and fee units | **`amount: string[]`** (the skill's `amounts` is wrong for SDK 10.8.1). **Live finding: the API requires `blockchain` alongside `tokenAddress`**, although the SDK types mark it optional; without it you get 400 "'blockchain' field may not be empty". `networkFee` is a decimal in USDC; Twokey rounds it up to 6 dp. | `packages/circle/src/transfers.ts` |
| 3 | Replaying `createTransaction` with the same `idempotencyKey` returns the original transaction | **Confirmed live.** Before the refId fix, reconcile could never find a transfer by listing, so every ambiguous attempt was resubmitted with the same key: 22/22 intents still had exactly one Circle transfer per `refId`. | chaos runs, Oct 27 |
| 4 | Typical Arc Testnet transfer fee | **≈ 0.0019–0.0021 USDC** at fee level MEDIUM (smoke transfer: 0.001888). | `pnpm circle:smoke`, `docs/demo-runs/` |
| 5 | App Kit chain name for Arc mainnet | Out of scope (M2). | |
| 6 | Contract-execution method name | **Confirmed:** `createContractExecutionTransaction` exists in SDK 10.8.1 (M2). | SDK `.d.ts` |
| 7 | Circle-side limits for developer-controlled wallets | Not found in the SDK surface. Documented spending policies are for mainnet Agent Wallets. | |
| 8 | Webhook helpers | `getNotificationSignature(keyId)` returns `{ id, algorithm, publicKey }`. **Not exercised live:** no webhook subscription is registered yet, so polling did all the work. | `packages/circle/src/webhooks.ts` |

More live findings (fixed, Oct 27):
- `listTransactions` **refuses `blockchain` together with `walletIds`** (400). Twokey now sends `walletIds` only.
- `listTransactions` **omits `refId`**; only `getTransaction` carries it. Reconcile now re-reads candidates (same destination and amount) with `getTransaction` to match `refId`.
- `getWalletTokenBalance` on Arc lists USDC **twice**: native (18 dp, `isNative: true`) and the ERC-20 at `0x3600…` (6 dp), with the same amount. Twokey takes the ERC-20 entry only and never sums them.
- Audit `seq` was a global primary key. A second org in the same database collided, so the key is now `(org_id, seq)` (migration 0002).

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

## Live on Arc Testnet (Circle developer-controlled wallets), Oct 27, 2026
- **Wallets:** set `3ca5bcaa-260c-5e2d-8ac1-9d0c4c5954b2`; treasury `0xcdb07ea35f4b3cb6bc4fea4e0154059d3a151897` (see `config/wallets.arc-testnet.json`).
- **Smoke transfer (`pnpm circle:smoke`):** 0.10 USDC → Oceanic, COMPLETE in 4.0 s, fee 0.001888.
  - tx [`0xa9bb6320…d522e7`](https://explorer.testnet.arc.io/tx/0xa9bb632019bcdb723d60ac499c6d5001f2c7c416676a30beabab1678d4d522e7)
  - balance 20.000000 → 19.898112
- **`pnpm demo:run`: 3 consecutive passes, 7/7 steps each.** Results are in `docs/demo-runs/`. Every tx receipt was also checked on the Arc RPC (status `0x1`).

  | Run | In-mandate (Oceanic 0.25) | Approved (Brightline 0.75) |
  |---|---|---|
  | 1 | [`0x05c9710e…`](https://explorer.testnet.arc.io/tx/0x05c9710eb7262b4c5539be23d6238ec6faee25a238a2e9c0813111690c4e7c9a), PAID in 5.2 s | [`0xf08e9996…`](https://explorer.testnet.arc.io/tx/0xf08e999681881ee022731027866f084a239875e3437e99b9c26adb055175da2c) |
  | 2 | [`0xf72fbabf…`](https://explorer.testnet.arc.io/tx/0xf72fbabf5c42ba226e50f72b6fd20c58a0d204b96ddd97834a4755fc03eeae80), 6.2 s | [`0x154e9b0d…`](https://explorer.testnet.arc.io/tx/0x154e9b0d09de3feb090f5a3519d7317f63b940446e3bbcd0f90dbae1d6f44529) |
  | 3 | [`0xc95fa378…`](https://explorer.testnet.arc.io/tx/0xc95fa37825795165d49dd8cef7574ec0d50fdcb2230f97fbc40364ba6e22c92e), 4.1 s | [`0xf7989948…`](https://explorer.testnet.arc.io/tx/0xf7989948d1777318fb810d8ddccae1ef6b286bb242fa0c4e03ebdb36940bd292) |

  In each run the pinned-payee request was blocked and the drift voided the approval (no Circle call). The balance fell by exactly amount + fee, give or take 1 micro-USDC of fee rounding.
- **`pnpm chaos --runs 5`: 20/20 paid exactly once, 0 double payments.** Each run covers:
  - a: 5 parallel requests with one key, plus a raced execute
  - b: crash before the Circle call
  - c: crash after Circle accepted
  - d: timeout before Circle

  The PRD asks for 20 runs per scenario; this is 5. Re-run `pnpm chaos --runs 20` for the full count (about 1 USDC).
