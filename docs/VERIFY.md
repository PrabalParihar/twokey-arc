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
