import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

export type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

/**
 * The only place Twokey builds a Circle client. Imported by the executor and local scripts, never by
 * apps/web. The SDK derives a fresh entity-secret ciphertext for every request; we never log either value.
 */
export function circleClientFromEnv(env: NodeJS.ProcessEnv = process.env): CircleClient {
  // Mainnet reads its own names (CIRCLE_LIVE_*), so a TEST key can never be pointed at real USDC by
  // accident, and a service on testnet can keep its TEST key next to one on mainnet.
  const mainnet = (env.TWOKEY_NETWORK ?? 'testnet') === 'mainnet';
  const apiKey = mainnet ? env.CIRCLE_LIVE_API_KEY : env.CIRCLE_API_KEY;
  const entitySecret = mainnet ? env.CIRCLE_LIVE_ENTITY_SECRET : env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error(
      mainnet
        ? 'CIRCLE_LIVE_API_KEY and CIRCLE_LIVE_ENTITY_SECRET must be set for mainnet (executor and local scripts only)'
        : 'CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set (executor and local scripts only)',
    );
  }
  if (!mainnet && !apiKey.startsWith('TEST_API_KEY:')) {
    throw new Error('testnet build expects a TEST_API_KEY; refusing to run with a live key');
  }
  if (mainnet && !apiKey.startsWith('LIVE_API_KEY:')) {
    throw new Error('mainnet expects a LIVE_API_KEY; refusing to run with a test key');
  }
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}
