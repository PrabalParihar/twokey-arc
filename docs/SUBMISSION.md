# Circle Grants Program · 2026 Cohort 2: application draft (for Prabal to review)

> This is a draft. Prabal edits it, records the video, and submits it himself on https://circle.questbook.app/ (the program showed **Open** on Oct 27, 2026).
> Placeholders in `«…»` get filled after the live testnet runs and the Railway deploy.
> Facts in this file are checked against the code; nothing in it claims users, volume or revenue.

## Project name
Twokey on Arc

## One line
The two-key rule for AI agents that move USDC: routine payments run on their own, risky ones wait for a human key sealed to the exact terms, rule-breaking ones are refused, and every decision lands on a hash-chained record. It runs on Circle developer-controlled wallets on Arc.

## Use case (2026 priority areas)
**Agentic commerce / agentic economic activity**, plus **payments** and **treasury management**. AI agents are starting to pay invoices and vendors. Teams can't hand them a wallet without a control layer: they need a mandate the agent can't exceed, a person who signs the exceptions, and a record a finance team can check without trusting the agent. Twokey is that layer, and it sits in front of a Circle wallet on Arc.

## What we built (testnet, open for review)
- **Repo:** https://github.com/PrabalParihar/twokey-arc «make public before submitting»
- **Live demo:** https://twokey.si (Railway: web + executor + Postgres, Arc Testnet)
- **Video (≤ 3 min):** «link»

How a payment moves:
1. An accounts-payable agent calls one tool, `twokey_pay`. It holds only a Twokey agent key: no wallet credentials and no Circle wallet ids.
2. Twokey's policy engine checks the request against a signed **mandate**:
   - per-payment cap
   - daily auto-pay cap
   - payees pinned to Arc addresses
   - hard maximum
   - USDC reserve for gas
   - expiry
3. **Inside the mandate:** the executor pays through **Circle developer-controlled wallets** (`createTransaction`, USDC `0x3600…0000` on **Arc Testnet**) and polls `getTransaction` to `COMPLETE`. The Arc tx hash is recorded.
4. **Outside the mandate** (new payee, over a cap): the payment waits for the owner. The approval is sealed with SHA-256 over the canonical terms: amount, payee address, chain, token, memo, expiry. If the agent changes one cent after approval, the seal no longer matches and nothing is sent.
5. **Breaks a rule** (a known payee at a new address, the zero address, over the hard max, insufficient USDC for amount + gas): blocked before any Circle call.
6. **Every decision** goes into an append-only, hash-chained audit log that carries the Circle transaction id and the Arc tx hash.

## How Arc and Circle are core (the grant's "platform alignment")
- **Arc is the settlement rail for every executed payment.** Gas is USDC from the same wallet, which is why the policy keeps an `amount + fee ≤ balance` invariant and a USDC reserve. Sub-second finality means a `COMPLETE` transfer is final when we record it.
- **Circle developer-controlled wallets are the only way money moves.**
  - The treasury and demo payees are created with `createWalletSet` / `createWallets` on `ARC-TESTNET`.
  - Payments go through `createTransaction` with an idempotency key committed *before* the call.
  - Status comes from `getTransaction`, the balance from `getWalletTokenBalance`, and reconciliation from `listTransactions`.
  - Circle webhooks (v2) are signature-verified.
- Full map, with file paths and line numbers: [CIRCLE_TRANSCRIPT.md](CIRCLE_TRANSCRIPT.md). Code screenshots: [docs/screenshots](screenshots).

## What Twokey adds over Circle's own agent-wallet controls
Circle's Agent Stack spending policies (caps and allow/block lists, set via the CLI, for mainnet agent wallets) are static yes/no rules. Twokey is complementary and adds:
- **A human second key per payment**, sealed to its exact terms.
- **Four lanes instead of allow/deny.** Out-of-mandate requests go to a person instead of failing.
- **Payee pinning.** The business-email-compromise pattern ("our wallet changed, pay this address") is refused outright.
- **An audit log** that ties each decision to the mandate version and the Arc tx hash.

Twokey can sit in front of the same wallet even when Circle-side caps are also set, as defense in depth.

## Evidence (testnet, Oct 27, 2026)
- `pnpm test`: **169 tests pass** (unit + Postgres integration). The policy engine has 100% branch coverage. Integration tests cover:
  - idempotency
  - the daily-cap race
  - seal mismatch (409)
  - drift void
  - write-ahead
  - crash and timeout recovery
  - agents can't approve
  - web refuses Circle credentials
- **Smoke transfer on Arc Testnet via Circle Wallets:** COMPLETE in 4.0 s, fee 0.001888 USDC, tx [`0xa9bb6320…`](https://explorer.testnet.arc.io/tx/0xa9bb632019bcdb723d60ac499c6d5001f2c7c416676a30beabab1678d4d522e7).
- **`pnpm demo:run`: 3 consecutive passes** against Arc Testnet with real Circle calls. In-mandate payments were PAID in 4–6 s; approved payments went out only after the sealed approval.
  - Tx hashes: [`0x05c9…`](https://explorer.testnet.arc.io/tx/0x05c9710eb7262b4c5539be23d6238ec6faee25a238a2e9c0813111690c4e7c9a), [`0xf08e…`](https://explorer.testnet.arc.io/tx/0xf08e999681881ee022731027866f084a239875e3437e99b9c26adb055175da2c), [`0xf72f…`](https://explorer.testnet.arc.io/tx/0xf72fbabf5c42ba226e50f72b6fd20c58a0d204b96ddd97834a4755fc03eeae80), [`0x154e…`](https://explorer.testnet.arc.io/tx/0x154e9b0d09de3feb090f5a3519d7317f63b940446e3bbcd0f90dbae1d6f44529), [`0xc95f…`](https://explorer.testnet.arc.io/tx/0xc95fa37825795165d49dd8cef7574ec0d50fdcb2230f97fbc40364ba6e22c92e), [`0xf798…`](https://explorer.testnet.arc.io/tx/0xf7989948d1777318fb810d8ddccae1ef6b286bb242fa0c4e03ebdb36940bd292)
- **Chaos suite on testnet:** 20 crash and timeout runs, **20/20 paid exactly once, 0 double payments**. This also confirms that Circle's idempotency key replay returns the original transfer.
- **What the live runs taught us about the Circle API:** see [VERIFY.md](VERIFY.md).
  - `blockchain` is required next to `tokenAddress`, but refused next to `walletIds`.
  - The list endpoint omits `refId`.
  - Arc USDC shows up as both a native entry and an ERC-20 entry.

## Team
**Prabal Pratap Singh**, solo founder (Lucknow, India). Background in smart contracts, DeFi and AI agents. Twokey's product site is https://twokey.online. «Add 1–2 lines of prior shipped work and links: GitHub, previous projects.»

## Traction
None yet, stated plainly: no users, no volume, no revenue. This is a working testnet build with an open-source quickstart. «If you have design-partner conversations, name them only with their permission.» The credible path: finance teams and agent builders who need an approval layer before they let an agent touch a treasury.

## Milestones and budget (USDC)
| Milestone | Amount | Deliverables | Timeline |
|---|---|---|---|
| **M1: Twokey guard live on Arc mainnet with Circle Wallets** | $4,000 | `ARC` mainnet config and a LIVE key with an entity secret Prabal registers. A small real treasury. Mainnet guardrails: a visible mainnet banner, a 100 USDC per-payment hard max at launch, an explicit confirmation step, and required Circle webhooks. Passkey step-up on approve (the WebAuthn challenge is the seal). A public demo; an audit log carrying Arc mainnet tx hashes. | weeks 1–4 |
| **M2: cross-chain payees under the same mandate, plus an open kit** | $6,000 | Payees on other chains, paid via CCTP V2 (App Kit / Bridge Kit with the Circle Wallets adapter) or Gateway. The destination chain, address and fee quote are sealed into the approval. Bridge error recovery uses `retryBridge` and never re-bridges an unknown state. Plus an open-source quickstart, the example agent and the MCP package. | weeks 5–10 |

Total requested: **$10,000 USDC** (within the program's published range).

## Links
- Code: «repo URL» · Demo: «Railway URL» · Video: «link» · Site: https://twokey.online
