import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { activateMandate, buildMandate, getActiveMandate } from '@twokey-arc/core';
import { createDb } from '@twokey-arc/db';
import { migrateDb } from '@twokey-arc/db/migrator';
import type { loadConfig } from './config';

const WALLETS = resolve(import.meta.dirname, '../../../config/wallets.arc-testnet.json');

/**
 * SEED_MANDATE_ON_BOOT=true: if the org has no active mandate yet (or its Telegram setting differs from
 * this deployment's), sign and activate the demo mandate
 * (scaled-down limits) with payees pinned to the wallets in config/wallets.arc-testnet.json.
 * Mandate only: agent keys are issued by the owner from the dashboard.
 */
export async function seedMandateIfMissing(conf: ReturnType<typeof loadConfig>, log: Logger): Promise<void> {
  if (!existsSync(WALLETS)) return log.warn('no config/wallets.arc-testnet.json; skipping mandate seed');
  const w = JSON.parse(readFileSync(WALLETS, 'utf8')) as {
    treasury: { id: string; address: string };
    demoTreasury?: { id: string; address: string };
    payees: { oceanic: { address: string }; harbor: { address: string } };
  };
  // SEED_PROFILE=public-demo: the visitors' demo org on its own wallet, with cents-sized limits.
  const demo = process.env.SEED_PROFILE === 'public-demo';
  if (demo && !w.demoTreasury) return log.warn('SEED_PROFILE=public-demo but no demoTreasury wallet; skipping mandate seed');
  const treasury = demo ? w.demoTreasury! : w.treasury;
  const { db, pool } = createDb(conf.databaseUrl, 1);
  try {
    await migrateDb(db);
    const active = await getActiveMandate(db, conf.cfg.orgId);
    const wantTelegram = !!conf.telegram;
    if (active && active.approval.telegram === wantTelegram && active.source_wallet.circle_wallet_id === treasury.id) return;
    // Demo deployment only: when Telegram is configured after the first seed, re-sign the same limits and
    // payees with the channel switched, as the next version (audited like any mandate change).
    const now = new Date();
    const doc = buildMandate(
      {
        network: conf.cfg.network,
        chainId: conf.cfg.chainId,
        usdcAddress: conf.cfg.usdcAddress,
        treasury: { walletId: treasury.id, address: treasury.address },
        timezone: process.env.ORG_TIMEZONE ?? 'Asia/Kolkata',
        limits: demo
          ? { per_tx: '0.05', daily: '5.00', hard_max_per_tx: '0.50', min_balance_after: '0.50' }
          : { per_tx: '0.50', daily: '1.50', hard_max_per_tx: '10.00', min_balance_after: '0.10' },
        payees: [
          { payee_id: 'pay_oceanic', name: 'Oceanic Freight', address: w.payees.oceanic.address },
          { payee_id: 'pay_harbor', name: 'Harbor Cloud', address: w.payees.harbor.address },
        ],
        validFrom: new Date(now.getTime() - 60_000),
        expiresAt: new Date(now.getTime() + 30 * 86_400_000),
        approval: { ttl_minutes: demo ? 10 : 15, telegram: wantTelegram },
        signedBy: process.env.OWNER_NAME ?? 'Prabal',
      },
      (active?.version ?? 0) + 1,
      now,
    );
    await db.transaction((tx) => activateMandate(tx, conf.cfg.orgId, doc, { type: 'system', id: 'seed-on-boot' }, now));
    log.info({ version: doc.version, telegram: wantTelegram, profile: demo ? 'public-demo' : 'owner' }, 'mandate seeded on boot');
  } finally {
    await pool.end();
  }
}
