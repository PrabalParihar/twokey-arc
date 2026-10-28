# Runbook

## Deploy on Railway (workspace "WIT Labs", project `twokey-arc`)
Railway has deprecated config-as-code, so each service's settings are set on the service instance (set once through `railway api` `serviceInstanceUpdate`):

| Service | Build | Start | Health |
|---|---|---|---|
| `web` (twokey.si, www.twokey.si) | `pnpm install --frozen-lockfile && pnpm --filter @twokey-arc/web build` | `pnpm --filter @twokey-arc/web start` (`PORT=3000`) | `/healthz` |
| `executor` (no public domain) | `pnpm install --frozen-lockfile` | `pnpm --filter @twokey-arc/executor start` | `/healthz` |
| `executor-demo` (no public domain) | `pnpm install --frozen-lockfile` | `pnpm --filter @twokey-arc/executor start` | `/healthz` |
| `Postgres` | Railway database | | |

Both app services deploy from `PrabalParihar/twokey-arc@main`, with `DATABASE_URL=${{Postgres.DATABASE_URL}}`. The executor runs migrations on boot.

Variables (names only; values come from your local `.env`):
- **executor:**
  - `DATABASE_URL`
  - `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`
  - `TWOKEY_NETWORK=testnet`
  - `APP_BASE_URL`
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_APPROVER_CHAT_ID`
- **web:**
  - `DATABASE_URL`
  - `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `OWNER_NAME`
  - `AGENT_KEY_PEPPER`
  - `DEMO_MODE=true`, `APPROVAL_GRACE_SECONDS=5`
  - `APP_BASE_URL`
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_APPROVER_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`

- **executor-demo** (the public demo at `/demo`; its own org and Circle wallet):
  - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
  - `CIRCLE_API_KEY=${{executor.CIRCLE_API_KEY}}`, `CIRCLE_ENTITY_SECRET=${{executor.CIRCLE_ENTITY_SECRET}}` (references, so the secrets live in one place)
  - `TWOKEY_NETWORK=testnet`, `TWOKEY_ORG_ID=org_demo`, `DEMO_MODE=true`
  - `SEED_MANDATE_ON_BOOT=true`, `SEED_PROFILE=public-demo`: treasury `demoTreasury` from `config/wallets.arc-testnet.json`, 0.05 per payment, 5.00 a day, no Telegram
- **web** also takes `PUBLIC_DEMO=true` to open `/demo`, and optionally `DEMO_DAILY_RUNS` (60) and `DEMO_RUNS_PER_HOUR` (6, per visitor and per IP).

Top up the demo treasury (`0xb78d23d8a7b57cd7dabd1ea5eeda8a2859478251`) at https://faucet.circle.com (Arc Testnet, 20 USDC every 2 hours). A run spends about 0.08 USDC plus gas when the visitor countersigns.

Never set `CIRCLE_*` on web: it refuses to boot.

Seed the deployed database from your machine:

```bash
DATABASE_URL=<railway public url> pnpm seed
```

Then point `TWOKEY_URL` at the web domain for the demo agent. Finally, register the Telegram webhook:

```bash
APP_BASE_URL=https://<web domain> pnpm telegram:setup webhook
```

## Daily cap during rehearsals
Demo amounts are scaled down: per payment 0.50, daily auto 1.50, and each run auto-pays 0.25. Four rehearsals in one IST day use 1.00. The cap resets at 00:00 IST. To start fresh sooner, run `pnpm seed`, which activates a new mandate version. Note that the daily total counts by day, not by version.

## Recording checklist (video ≤ 3:00, PRD §20)
1. Run `pnpm seed`, then open the dashboard on the left and a terminal on the right. Have an Arc explorer tab open.
2. `/mandate`: limits, pinned payees, the treasury balance from Circle.
3. `pnpm demo:agent --run take1`:
   - INV-88213 → `executed` → click the Arc tx link;
   - BM-7 → `pending_approval`.
4. Approval card: show the failed checks and the seal, then **Hold to approve** → Paid + tx link. Optionally approve from Telegram on the phone.
5. INV-88240 ("our wallet changed") → `blocked`, `INV-PAYEE-PINNED`.
6. HC-2210 → approve, then press **Demo: drift +0.50** inside the 5 s grace window → "approval no longer matches… Nothing was sent."
7. `/audit` → **Verify chain** → each paid line shows the Circle tx id and Arc tx hash.
8. README + milestones.

## If something is stuck
- **`UNCONFIRMED`:** reconcile looks the transfer up by `refId`, then replays the same idempotency key (at most 3 times), then marks it `NEEDS_HUMAN`. Check the treasury in the Circle console.
- **`STUCK` (fee too low):** shown on the dashboard. Acceleration is a later, human-clicked feature.
- **Balance not moving:** the executor refreshes it every 60 s and after each payment.

## Arc mainnet launch
Arc mainnet: chain 5042, Circle code `ARC`, RPC https://rpc.mainnet.arc.io, explorer https://explorer.arc.io, USDC `0x3600…0000` (6 dp, also the gas). The owner's treasury moves to mainnet in a new org (`org_mainnet`), with a fresh mandate and audit chain. The public demo stays on testnet: `executor-demo` refuses `ARC`, and the web pins the demo to testnet.

Prabal only (real money and account security):
1. Circle Console, Live mode: create a LIVE API key, and register the entity secret for live.
2. Put both in the local `.env` as `CIRCLE_LIVE_API_KEY` and `CIRCLE_LIVE_ENTITY_SECRET`, and on the Railway `executor` service under the same names. The `executor` keeps its `CIRCLE_API_KEY` (TEST): `executor-demo` references it.
3. After step 4, send about 20 USDC on Arc mainnet to the new treasury address.

Then:

4. Create the mainnet wallets. This moves no money; it writes `config/wallets.arc-mainnet.json`:

```bash
TWOKEY_NETWORK=mainnet TWOKEY_ALLOW_MAINNET=i-understand-real-usdc pnpm circle:setup
```

5. Commit the wallets file. Set the same variables on both services: `TWOKEY_NETWORK=mainnet`, `TWOKEY_ALLOW_MAINNET=i-understand-real-usdc` and `TWOKEY_ORG_ID=org_mainnet` on `executor` and on `web`. Then deploy both. On boot, the executor seeds mandate v1 on `ARC` with tighter limits: 0.50 per payment, 2.00 a day, a 5.00 hard max, and 1.00 kept for gas.
6. Prabal signs in, issues the agent key on `/app/mandate`, and makes the first payment himself:
   - with `pnpm demo:agent` against https://twokey.si,
   - or with a 0.10 smoke transfer to his own payee wallet: `TWOKEY_NETWORK=mainnet TWOKEY_ALLOW_MAINNET=i-understand-real-usdc pnpm circle:smoke`.
