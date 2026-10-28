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
