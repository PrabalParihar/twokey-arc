import { createPublicKey, verify } from 'node:crypto';
import type { CircleClient } from './client';

/** Circle v2 notification envelope (at-least-once, unordered: dedupe on notificationId). */
export interface CircleNotification {
  subscriptionId: string;
  notificationId: string;
  notificationType: string;
  notification: Record<string, unknown>;
  timestamp: string;
  version: number;
}

const keyCache = new Map<string, { publicKey: string; algorithm: string }>();

/**
 * Verifies X-Circle-Signature (ECDSA_SHA_256, base64) over the raw body with the public key for
 * X-Circle-Key-Id. Fetching that key needs the API key, which is why verification runs in the
 * executor: apps/web only stores the raw event. [VERIFY key encoding against a live webhook]
 */
export async function verifyCircleSignature(
  client: CircleClient,
  i: { rawBody: string; signature: string; keyId: string },
): Promise<boolean> {
  let key = keyCache.get(i.keyId);
  if (!key) {
    const res = await client.getNotificationSignature(i.keyId);
    if (!res.data?.publicKey) return false;
    key = { publicKey: res.data.publicKey, algorithm: res.data.algorithm };
    keyCache.set(i.keyId, key);
  }
  return verifyWithPublicKey(key.publicKey, i.rawBody, i.signature);
}

/** Pure part, testable with a locally generated P-256 key. `publicKeyB64` is a base64 DER SPKI. */
export function verifyWithPublicKey(publicKeyB64: string, rawBody: string, signatureB64: string): boolean {
  try {
    const pub = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    return verify('sha256', Buffer.from(rawBody, 'utf8'), pub, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
