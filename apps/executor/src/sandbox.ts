import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, gt } from 'drizzle-orm';
import type { Logger } from 'pino';
import { createUsdcTransfer, getUsdcBalance, type CircleClient } from '@twokey-arc/circle';
import { appendAudit, getActiveMandate, newId, type CoreConfig } from '@twokey-arc/core';
import { balanceSnapshots, orgs, type Db } from '@twokey-arc/db';
import type { loadConfig } from './config';

type Conf = ReturnType<typeof loadConfig>;

/** Circle wants a UUID idempotency key; derive it from the org id so a retried creation returns the same wallet. */
const uuidFor = (s: string) => {
  const h = createHash('sha256').update(`twokey-sandbox:${s}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const testnetWallets = () => {
  const file = resolve(import.meta.dirname, '../../../config/wallets.arc-testnet.json');
  if (!existsSync(file)) throw new Error('SANDBOX_HOST needs config/wallets.arc-testnet.json (or SANDBOX_WALLET_SET_ID and SANDBOX_RESERVE_WALLET_ID)');
  return JSON.parse(readFileSync(file, 'utf8')) as { walletSetId: string; treasury: { id: string } };
};
/** The wallet set sandbox wallets live in: SANDBOX_WALLET_SET_ID, else the testnet wallet set from config. */
const walletSetId = () => process.env.SANDBOX_WALLET_SET_ID ?? testnetWallets().walletSetId;
/**
 * When Circle's faucet API refuses (it rate-limits), a new workspace gets a small grant from Twokey's own
 * testnet treasury instead: SANDBOX_RESERVE_WALLET_ID, else the testnet treasury from config. Test USDC only.
 */
const reserveWalletId = () => process.env.SANDBOX_RESERVE_WALLET_ID ?? testnetWallets().treasury.id;
const GRANT = process.env.SANDBOX_GRANT_USDC ?? '1.00';

/**
 * The testnet executor's sandbox duties: create each new workspace's Circle wallet on Arc Testnet, ask the
 * faucet for test USDC, start serving the workspace's queues, and keep its balance fresh until a mandate exists
 * (after that the regular balance refresh takes over).
 */
export async function startSandboxHost(i: {
  db: Db;
  client: CircleClient;
  log: Logger;
  conf: Conf;
  timers: NodeJS.Timeout[];
  serve: (cfg: CoreConfig) => Promise<void>;
}) {
  const { db, client, conf } = i;
  const log = i.log.child({ part: 'sandbox' });
  const setId = walletSetId();
  const reserve = reserveWalletId();
  const served = new Set<string>();
  const cfgOf = (orgId: string): CoreConfig => ({ ...conf.cfg, orgId, demoMode: false, approvalGraceSeconds: 0 });
  const serve = async (orgId: string) => {
    if (served.has(orgId)) return;
    served.add(orgId);
    await i.serve(cfgOf(orgId));
  };

  for (const o of await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.status, 'READY'))) await serve(o.id);
  log.info({ workspaces: served.size }, 'sandbox host serving');

  let busy = false;
  const provision = async () => {
    if (busy) return;
    busy = true;
    try {
      const pending = await db.select().from(orgs).where(eq(orgs.status, 'PROVISIONING')).orderBy(orgs.createdAt).limit(5);
      for (const org of pending) {
        try {
          const created = await client.createWallets({
            walletSetId: setId,
            blockchains: ['ARC-TESTNET'],
            accountType: 'EOA',
            count: 1,
            metadata: [{ name: org.name.slice(0, 50), refId: org.id }],
            idempotencyKey: uuidFor(org.id),
          });
          const w = created.data?.wallets?.[0];
          if (!w) throw new Error('Circle returned no wallet');
          const now = new Date();
          await db.transaction(async (tx) => {
            await tx.update(orgs).set({ status: 'READY', walletId: w.id, walletAddress: w.address, provisionError: null }).where(eq(orgs.id, org.id));
            await appendAudit(tx, org.id, {
              at: now, actorType: 'system', actorId: 'sandbox-host', verb: 'workspace.wallet_created', subjectType: 'org', subjectId: org.id,
              data: { circle_wallet_id: w.id, address: w.address.toLowerCase(), network: 'ARC-TESTNET' },
            });
          });
          log.info({ org: org.id, address: w.address }, 'sandbox wallet created');
          await serve(org.id);
          // Never awaited: a slow faucet must not hold up the next workspace's wallet.
          void requestFaucet(org.id, w.address);
        } catch (err) {
          const msg = (err as Error).message.slice(0, 200);
          log.warn({ org: org.id, err: msg }, 'sandbox provisioning failed');
          // Older than ten minutes and still failing: stop retrying and show the owner what went wrong.
          if (Date.now() - org.createdAt.getTime() > 600_000) await db.update(orgs).set({ status: 'FAILED', provisionError: msg }).where(eq(orgs.id, org.id));
        }
      }
    } finally {
      busy = false;
    }
  };

  const requestFaucet = async (orgId: string, address: string) => {
    await db.update(orgs).set({ faucetRequestedAt: new Date() }).where(eq(orgs.id, orgId));
    try {
      await Promise.race([
        client.requestTestnetTokens({ address, blockchain: 'ARC-TESTNET', usdc: true }),
        new Promise((_, no) => setTimeout(() => no(new Error('faucet timed out after 30 s')), 30_000)),
      ]);
      log.info({ org: orgId }, 'faucet requested');
    } catch (err) {
      log.warn({ org: orgId, err: (err as Error).message.slice(0, 200) }, 'faucet refused');
      await grantFromReserve(orgId, address);
    }
  };

  // One grant per workspace: the idempotency key is derived from the org, so Circle returns the same transfer.
  const grantFromReserve = async (orgId: string, address: string) => {
    try {
      const t = await createUsdcTransfer(client, {
        walletId: reserve,
        tokenAddress: conf.cfg.usdcAddress,
        blockchain: 'ARC-TESTNET',
        destinationAddress: address,
        amount: GRANT,
        idempotencyKey: uuidFor(`grant:${orgId}`),
        refId: `sandbox-grant:${orgId}`,
      });
      await db.transaction((tx) =>
        appendAudit(tx, orgId, {
          at: new Date(), actorType: 'system', actorId: 'sandbox-host', verb: 'workspace.funded', subjectType: 'org', subjectId: orgId,
          data: { source: 'twokey_testnet_reserve', amount: GRANT, circle_transaction_id: t.id },
        }),
      );
      log.info({ org: orgId, circleTx: t.id, amount: GRANT }, 'reserve grant sent');
    } catch (err) {
      // The owner can still fund it at faucet.circle.com; the console shows the address and the link.
      log.warn({ org: orgId, err: (err as Error).message.slice(0, 200) }, 'reserve grant failed');
    }
  };

  // Before a mandate exists the regular refresh has no wallet to read, so the host snapshots it here.
  const balances = async () => {
    const ready = await db.select().from(orgs).where(and(eq(orgs.status, 'READY'), gt(orgs.createdAt, new Date(Date.now() - 86_400_000))));
    for (const org of ready) {
      if (!org.walletId || (await getActiveMandate(db, org.id))) continue;
      // Still empty three minutes after the first ask: ask once more (the timestamp moves, so only once).
      const asked = org.faucetRequestedAt?.getTime() ?? 0;
      const retry = asked && Date.now() - asked > 180_000 && Date.now() - org.createdAt.getTime() < 600_000 && asked - org.createdAt.getTime() < 120_000;
      const usdc = await getUsdcBalance(client, org.walletId, conf.cfg.usdcAddress).catch(() => null);
      if (usdc === null) continue;
      if (retry && Number(usdc) === 0 && org.walletAddress) void requestFaucet(org.id, org.walletAddress);
      await db.insert(balanceSnapshots).values({
        id: newId('bal'), orgId: org.id, walletId: org.walletId, usdcAmount: usdc, feeEstimate: conf.cfg.defaultFeeEstimateUsdc, source: 'poll', takenAt: new Date(),
      });
    }
  };

  const every = (ms: number, name: string, fn: () => Promise<unknown>) =>
    i.timers.push(setInterval(() => fn().catch((e: Error) => log.warn({ task: name, err: e.message }, 'sandbox task failed')), ms));
  every(3_000, 'provision', provision);
  every(15_000, 'balances', balances);
}
