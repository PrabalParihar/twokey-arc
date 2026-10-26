import { arcNetwork } from '@twokey-arc/circle';
import type { CoreConfig } from '@twokey-arc/core';

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

export function loadConfig() {
  const net = arcNetwork();
  const cfg: CoreConfig = {
    orgId: process.env.TWOKEY_ORG_ID ?? 'org_twokey',
    network: net.circleBlockchain,
    chainId: net.chainId,
    usdcAddress: process.env.USDC_TOKEN_ADDRESS ?? net.usdc,
    explorerUrl: process.env.ARC_EXPLORER_URL ?? net.explorerUrl,
    defaultFeeEstimateUsdc: process.env.DEFAULT_FEE_ESTIMATE_USDC ?? '0.010000',
    approvalGraceSeconds: Number(process.env.APPROVAL_GRACE_SECONDS ?? 0),
    demoMode: process.env.DEMO_MODE === 'true',
  };
  return {
    cfg,
    net,
    databaseUrl: process.env.DATABASE_URL_EXECUTOR ?? need('DATABASE_URL'),
    port: Number(process.env.PORT ?? 8081),
    telegram: process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_APPROVER_CHAT_ID
      ? {
          token: process.env.TELEGRAM_BOT_TOKEN,
          chatId: process.env.TELEGRAM_APPROVER_CHAT_ID,
          appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
          maxApproveUsdc: process.env.TELEGRAM_MAX_APPROVE_USDC ?? '100',
        }
      : null,
  };
}
