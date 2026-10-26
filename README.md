# Twokey on Arc

**The two-key rule for AI agents that move USDC.**

Twokey sits in front of a Circle developer-controlled wallet on Arc and handles every payment an agent asks for:
- **Inside your mandate:** routine payments run on their own.
- **Outside your mandate:** the payment waits for a human key sealed to the exact terms.
- **Breaks a rule:** refused, with no override.

Every decision goes on a hash-chained record.

This repo is a testnet build: Arc Testnet (chain `5042002`), USDC, Circle Wallets. No real money moves.

```
agent ──twokey_pay──▶ Twokey API ──classify──▶ policy (pure)
                         │                      ├─ inside the mandate  → executor → Circle Wallets → Arc
                         │                      ├─ adds risk           → sealed approval → owner holds to approve → executor → Circle
                         │                      └─ breaks a rule       → blocked, nothing sent
                         └──────────── every step ──▶ hash-chained audit log
```

- The agent holds only a Twokey agent key. It never sees wallet credentials or Circle wallet ids.
- Only `apps/executor` holds `CIRCLE_API_KEY` / `CIRCLE_ENTITY_SECRET`. `apps/web` refuses to boot if either is in its environment.
- An approval is `sha256(JCS(terms))` over amount, payee address, chain, token, memo and expiry. The executor rebuilds the terms and recomputes the seal right before `createTransaction`, so one changed cent voids it.
- The Circle `idempotencyKey` is committed **before** the call (write-ahead). After a timeout or crash, the same key is reused and the transfer is never re-minted.

## What's in here

| Path | What |
|---|---|
| `packages/policy` | Pure, deterministic lane engine (`classify`), 100% branch coverage |
| `packages/seal` | RFC 8785 JCS + SHA-256: approval seals, payee fingerprints, the audit hash chain |
| `packages/money` | USDC as exact 6-dp decimal strings (bigint micro-units, never floats) |
| `packages/circle` | Thin typed wrapper over `@circle-fin/developer-controlled-wallets` 10.8.1 |
| `packages/core` | Intake, sealed approvals, executor (write-ahead, poll, reconcile, sweeper), audit |
| `packages/db` | Drizzle schema + migrations; the audit log is append-only by trigger |
| `packages/sdk` | `createTwokey({ baseUrl, apiKey })` → `agent.guard(...)`, `agent.waitFor(...)`, tool handlers |
| `apps/web` | Next.js 15 dashboard (Today, approval card with Hold to approve, Mandate, Audit) + `/api/v1` |
| `apps/executor` | pg-boss worker: the only process that talks to Circle |
| `apps/demo-agent` | Scripted accounts-payable agent reading `fixtures/inbox` |
| `apps/mcp` | MCP server (`twokey_pay`, `twokey_get_payment`, `twokey_get_mandate`), stdio + Streamable HTTP |
| `docs/` | [Circle transcript](docs/CIRCLE_TRANSCRIPT.md), [architecture](docs/ARCHITECTURE.md), [policy](docs/POLICY.md), [runbook](docs/RUNBOOK.md), [threat model](docs/THREAT_MODEL.md), [verification log](docs/VERIFY.md), [code screenshots](docs/screenshots) |

## Quickstart (about 20 minutes)

You need Node 22+, pnpm 10 and Docker.

```bash
git clone https://github.com/PrabalParihar/twokey-arc && cd twokey-arc
pnpm install
pnpm test                     # unit + integration (Testcontainers starts a throwaway Postgres)
```

**1. Circle (5 min, in the browser).**
1. Create an account at https://console.circle.com.
2. Create a **testnet** API key.
3. Generate and register an entity secret ([guide](https://developers.circle.com/wallets/dev-controlled/register-entity-secret)). Keep the recovery file outside this folder.
4. Copy the env template and fill in the two Circle values:

```bash
cp .env.example .env          # then set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in .env
```

**2. Database, wallets, mandate.**

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm circle:setup             # wallet set + 4 EOA wallets on ARC-TESTNET, faucet USDC for the treasury
pnpm circle:smoke             # one raw 0.10 USDC transfer, polled to COMPLETE: proves the rail
pnpm owner:set-password you@example.com
pnpm seed                     # mandate v1 (payees pinned to the new wallets) + the demo agent's key
```

If the faucet API refuses, fund the treasury address `circle:setup` prints at https://faucet.circle.com (Arc Testnet).

**3. Run it** (two terminals):

```bash
pnpm dev:web                  # http://localhost:3000, sign in with the owner email + password
pnpm dev:executor
```

**4. Watch the agent.**

```bash
pnpm demo:agent               # pays Oceanic (runs on its own), asks for Brightline (needs you),
                              # gets blocked on the "our wallet changed" email, asks for Harbor
```

Open the dashboard and hold to approve Brightline. To check everything end to end against Arc Testnet:

```bash
DEMO_OWNER_PASSWORD=... pnpm demo:run   # asserts lanes, PAID + tx hash, seal 409s, drift void, audit, balance
pnpm chaos --runs 5                     # crash/timeout scenarios on testnet, 0.01 USDC each: 0 double payments
```

## Using it from an agent

```ts
import { createTwokey } from '@twokey-arc/sdk';
const { agent } = createTwokey({ baseUrl: process.env.TWOKEY_URL!, apiKey: process.env.TWOKEY_AGENT_KEY! });

const r = await agent.guard(
  { type: 'PAY', payee: { payeeId: 'pay_oceanic' }, amount: '0.25', memo: 'INV-88213' },
  { agentId: 'ap-agent', idempotencyKey: 'invoice:INV-88213' },
);
// r.outcome: 'executed' | 'pending_approval' | 'blocked'; r.ruleId and r.checks always
```

MCP (Claude Code, Cursor):

```json
{ "mcpServers": { "twokey": { "command": "pnpm", "args": ["--silent", "mcp"], "env": { "TWOKEY_URL": "http://localhost:3000", "TWOKEY_AGENT_KEY": "tk_agent_…" } } } }
```

## Status

`pnpm demo:run` and `pnpm chaos` call real Circle Wallets on Arc Testnet. Each live run is saved in `docs/demo-runs/`, and [docs/VERIFY.md](docs/VERIFY.md) records what has and hasn't been checked live yet. Mainnet is milestone M1 and is refused by this build (`arcNetwork()` throws on mainnet). Cross-chain payees through CCTP V2 / Gateway are milestone M2 and are not implemented here. There are no users or volume yet.

## How Twokey relates to Circle's own controls

Circle's Agent Stack offers spending policies for agent wallets: caps and allow/block lists, set via the CLI, for mainnet agent wallets. Twokey is complementary and adds four things on top:
- a human second key per payment, sealed to its exact terms;
- four lanes instead of allow/deny;
- payees pinned to addresses, so a known payee at a new address is blocked;
- a hash-chained audit log tied to Arc tx hashes.
