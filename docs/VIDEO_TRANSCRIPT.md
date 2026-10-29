# Twokey on Arc: video transcript

Video: https://twokey.si/video (4:33). Recorded on real Arc Testnet transactions through Circle developer-controlled wallets, plus the mainnet treasury on the Arc explorer. Code: https://github.com/PrabalParihar/twokey-arc

## Part 1: the product, live

| On screen | Narration |
|---|---|
| twokey.si landing (live) | AI agents can pay bills now. The hard part is letting them... without handing over the keys to your treasury. |
| twokey.si landing, live decisions window | Twokey is the two-key rule for agents that pay in USDC on Arc. Routine payments go on their own, risky ones wait for your key, and anything that breaks a rule is refused. |
| twokey.si/signup: new sandbox | Anyone can try it. Sign up for a free sandbox: just an email and a password. |
| Setup sheet: Circle wallet created on Arc Testnet (createWallets), funded (faucet or testnet reserve) | Twokey creates your own Circle developer-controlled wallet on Arc Testnet, and funds it with test USDC. That's a real wallet, created in a few seconds. |
| Mandate wizard: limits and pinned payees | Then you decide what your agent may pay on its own. Fifty cents a payment, a dollar fifty a day, and two payees you trust. |
| Hold to sign mandate v1 | Hold to sign. That's mandate version one, and every version is kept. |
| The agent's badge | Your agent gets a badge. It carries the mandate into every payment, and its key can ask... but it can never approve, and it never sees a wallet. |
| Scratch to reveal the agent key (shown once) | The key is shown once, so you scratch it off. |
| 0.10 USDC inside the mandate: createTransaction on Arc, Paid on Arc | Now the agent asks to pay ten cents to a pinned payee. That's inside the mandate, so Circle Wallets pays it on Arc, in a few seconds, with the transaction on the record. |
| 0.60 USDC over the cap: Needs you, sealed approval | Now it asks for sixty cents. That's over the cap, so it doesn't fail, and it doesn't just go. It waits for you, sealed to the exact terms. |
| Hold to approve; executor re-verifies the seal; createTransaction; Paid | You check the seal and hold to approve. Right before paying, the executor re-checks that seal. If even one cent had changed, nothing would be sent. |

## Part 2: the code (Circle integrations)

| Circle product on screen | File | Narration |
|---|---|---|
| The code: only the executor talks to Circle | `github.com/PrabalParihar/twokey-arc` | Now the code. Twokey has one rule for credentials: only the executor talks to Circle. The agent holds a Twokey key, and the web app refuses to start if Circle credentials are in its environment. |
| Circle Wallets · developer-controlled wallets client | `packages/circle/src/client.ts` | The executor creates the Circle developer-controlled wallets client here, with the test or live keys depending on the network. On mainnet that takes two deliberate settings and separate live keys. |
| Circle Wallets · createWalletSet, createWallets on Arc · Faucet | `scripts/circle-setup.ts` | The setup script creates a wallet set and E O A wallets on Arc with create wallet set and create wallets, and asks Circle's faucet for test USDC. Self-serve sandboxes get their own wallet the same way, from the testnet executor. |
| USDC on Arc · createTransaction | `packages/circle/src/transfers.ts` | Every payment is a USDC transfer through create transaction. The idempotency key is written to our database before the call, so a crash or a timeout can never pay twice. Twenty out of twenty chaos runs paid exactly once. |
| Circle Wallets · getTransaction to a final state | `packages/core/src/executor.ts` | The executor polls get transaction until a terminal state, and records the Circle transaction id and the Arc transaction hash on the audit log. |
| USDC as gas on Arc · getWalletTokenBalance | `packages/circle/src/balances.ts` | Balances come from get wallet token balance, using the six-decimal USDC view only. Arc pays gas in USDC, so the policy checks amount plus fee against this one balance, and keeps a reserve. |
| The guard in front of Circle: re-classify, re-verify the seal | `packages/core/src/executor.ts` | And this is the guard in front of Circle. Right before create transaction, the executor takes the org lock, reads a fresh balance, classifies the payment again and re-verifies the approval seal. If anything moved, nothing is sent. |
| Circle webhooks v2 · signature verified | `packages/circle/src/webhooks.ts` | Circle webhooks are stored by the web app and verified by the executor against Circle's notification signature, with polling as the fallback. The full map of every Circle call, with line numbers, is in the circle transcript file in the repo. |

## Part 3: the record and mainnet

| On screen | Narration |
|---|---|
| Audit log: hash-chained, Circle tx ids and Arc tx hashes | And every decision lands on a hash-chained audit log, with the Circle transaction and the Arc hash, so finance can check it without trusting the agent. |
| explorer.arc.io: Twokey's mainnet treasury 0x6d57…dbf2 | This isn't only a testnet demo. Twokey's own treasury runs on Arc mainnet, through the same code, with real USDC. |
| twokey.si, developers section | Twokey on Arc. Try the sandbox at twokey dot s i. The code is open source on GitHub. |

---

# Where each Circle product is in the code
Twokey is an approval layer for AI agents that move USDC. In this demo an accounts-payable agent requests payments. Twokey's policy code decides what happens, and only Twokey's executor can move money through Circle.

| Circle product | What it does in Twokey | Where in the code |
|---|---|---|
| **Arc Testnet** (chain `5042002`) | The settlement rail for every payment. Gas is paid in USDC, and with sub-second finality a `COMPLETE` transfer is final, which the audit log records. | [`packages/circle/src/config.ts` L4–L11](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/circle/src/config.ts#L4-L11) (chain id, `ARC-TESTNET`, RPC, explorer)<br>[`packages/circle/src/config.ts` L29–L39](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/circle/src/config.ts#L29-L39) (testnet-only guard)<br>[`apps/web/lib/explorer.ts` L5](https://github.com/PrabalParihar/twokey-arc/blob/main/apps/web/lib/explorer.ts#L5) (explorer links) |
| **USDC on Arc** (`0x3600…0000`, 6-dp ERC-20 view) | The asset being paid and also the gas token. Twokey reads one balance and never adds the 18-dp native view to the 6-dp ERC-20 view. | [`packages/money/src/usdc.ts` L10](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/money/src/usdc.ts#L10) (address)<br>[`packages/money/src/usdc.ts` L28–L35](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/money/src/usdc.ts#L28-L35) (exact 6-dp parsing, no floats)<br>[`packages/circle/src/balances.ts` L14–L19](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/circle/src/balances.ts#L14-L19) (one balance, one view)<br>[`packages/circle/src/units.ts` L10–L17](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/circle/src/units.ts#L10-L17) (Circle fee → 6 dp, rounded up) |
| **Circle Wallets: developer-controlled wallets** (`@circle-fin/developer-controlled-wallets` 10.8.1) | The treasury wallet the agent pays from. The wallet set and wallets are created on `ARC-TESTNET`. Transfers go through `createTransaction` with an idempotency key written ahead, status through `getTransaction`, balance through `getWalletTokenBalance`, and reconciliation through `listTransactions`. Only the executor holds the credentials. | [`packages/circle/src/client.ts` L9–L29](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/circle/src/client.ts#L9-L29) (`initiateDeveloperControlledWalletsClient`)<br>[`scripts/circle-setup.ts` L18](https://github.com/PrabalParihar/twokey-arc/blob/main/scripts/circle-setup.ts#L18) (`createWalletSet`)<br>[`scripts/circle-setup.ts` L25–L31](https://github.com/PrabalParihar/twokey-arc/blob/main/scripts/circle-setup.ts#L25-L31) (`createWallets` on `ARC-TESTNET`, EOA)<br>[`packages/circle/src/transfers.ts` L42–L59](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/circle/src/transfers.ts#L42-L59) (`createTransaction` with USDC, `idempotencyKey`, `refId`)<br>[`packages/circle/src/transfers.ts` L93–L102](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/circle/src/transfers.ts#L93-L102) (`getTransaction`)<br>[`packages/circle/src/transfers.ts` L108–L123](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/circle/src/transfers.ts#L108-L123) (`listTransactions` for reconcile)<br>[`packages/circle/src/transfers.ts` L126–L139](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/circle/src/transfers.ts#L126-L139) (`estimateTransferFee`)<br>[`packages/circle/src/balances.ts` L21–L24](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/circle/src/balances.ts#L21-L24) (`getWalletTokenBalance`)<br>[`apps/executor/src/circle-port.ts` L14–L26](https://github.com/PrabalParihar/twokey-arc/blob/main/apps/executor/src/circle-port.ts#L14-L26) (the executor-only adapter) |
| **The guard in front of Circle** | Before any `createTransaction` runs, the executor takes the org lock, reads a fresh balance from Circle, classifies the payment a third time, rebuilds and re-verifies the approval seal, and commits the attempt row with its idempotency key. Only then does it call Circle. | [`packages/core/src/executor.ts` L90–L182](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/core/src/executor.ts#L90-L182) (re-classify + seal check + write-ahead)<br>[`packages/core/src/executor.ts` L185–L235](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/core/src/executor.ts#L185-L235) (the Circle call site)<br>[`packages/core/src/executor.ts` L238–L288](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/core/src/executor.ts#L238-L288) (poll to `COMPLETE` + tx hash)<br>[`packages/core/src/executor.ts` L294–L337](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/core/src/executor.ts#L294-L337) (same-key reconcile)<br>[`apps/executor/src/jobs/execute-payment.ts` L9–L12](https://github.com/PrabalParihar/twokey-arc/blob/main/apps/executor/src/jobs/execute-payment.ts#L9-L12) (pg-boss job)<br>[`apps/executor/src/jobs/poll-attempt.ts` L14–L33](https://github.com/PrabalParihar/twokey-arc/blob/main/apps/executor/src/jobs/poll-attempt.ts#L14-L33) (pg-boss job) |
| **Circle Faucet / testnet tokens** | Funds the demo treasury with testnet USDC. | [`scripts/circle-setup.ts` L48](https://github.com/PrabalParihar/twokey-arc/blob/main/scripts/circle-setup.ts#L48) (`requestTestnetTokens`)<br>or https://faucet.circle.com |
| **Circle webhooks (v2)** | Push updates on transaction state. Web stores the raw event (deduplicated on `notificationId`). The executor, which holds the API key, verifies `X-Circle-Signature` with the key from `getNotificationSignature` before acting. Polling stays as the fallback. | [`apps/web/app/api/circle/webhook/route.ts` L10–L36](https://github.com/PrabalParihar/twokey-arc/blob/main/apps/web/app/api/circle/webhook/route.ts#L10-L36) (receive + dedupe)<br>[`packages/circle/src/webhooks.ts` L21–L33](https://github.com/PrabalParihar/twokey-arc/blob/main/packages/circle/src/webhooks.ts#L21-L33) (ECDSA P-256 / SHA-256)<br>[`apps/executor/src/jobs/process-webhook.ts` L12–L25](https://github.com/PrabalParihar/twokey-arc/blob/main/apps/executor/src/jobs/process-webhook.ts#L12-L25) (verify, then act) |
| CCTP V2 via App Kit / Bridge Kit | **Planned (M2), not in this build.** It will pay a payee on another chain under the same mandate, with the destination chain and address sealed into the approval. | `packages/circle/src/bridge.ts` (M2) |
| Gateway | **Planned (M2), not in this build.** Instant cross-chain payouts from a unified USDC balance. | `packages/circle/src/gateway.ts` (M2) |

**Flow in the video**
1. An in-mandate payment goes through `createTransaction` on Arc and reaches `COMPLETE` with a tx hash.
2. An out-of-mandate payment gets a sealed approval, and only after that a `createTransaction`.
3. A pinned-payee violation is blocked before any Circle call.
4. Drift after approval voids it, and no Circle call is made.
5. The audit chain is verified, with Circle tx ids and Arc tx hashes.

_Generated by `pnpm transcript` from the code at the commit it ships with. Line numbers are found by searching for each anchor, not typed by hand._
