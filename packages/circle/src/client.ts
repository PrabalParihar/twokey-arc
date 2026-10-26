import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

export type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

/**
 * The only place Twokey builds a Circle client. Imported by the executor and local scripts, never by
 * apps/web. The SDK derives a fresh entity-secret ciphertext for every request; we never log either value.
 */
export function circleClientFromEnv(env: NodeJS.ProcessEnv = process.env): CircleClient {
  const apiKey = env.CIRCLE_API_KEY;
  const entitySecret = env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error('CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set (executor and local scripts only)');
  }
  if ((env.TWOKEY_NETWORK ?? 'testnet') === 'testnet' && !apiKey.startsWith('TEST_API_KEY:')) {
    throw new Error('testnet build expects a TEST_API_KEY; refusing to run with a live key');
  }
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}
