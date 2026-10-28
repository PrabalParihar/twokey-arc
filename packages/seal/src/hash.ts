import { createHash } from 'node:crypto';
import canonicalizeJcs from 'canonicalize';

/** RFC 8785 (JCS) canonical JSON. Throws on values JSON can't carry exactly (bigint, undefined at the top). */
export function canonicalize(value: unknown): string {
  const out = canonicalizeJcs(value);
  if (out === undefined) throw new TypeError('value is not canonicalizable');
  return out;
}

export const sha256Hex = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

/** `sha256:` + hex(sha256(utf8(jcs(value)))). */
export const sealOf = (value: unknown): string => `sha256:${sha256Hex(canonicalize(value))}`;

/** First 12 hex characters of a seal, grouped for reading aloud: "6e47 3773 7448". */
export function sealGroups(seal: string): string {
  const hex = seal.replace(/^sha256:/, '').slice(0, 12);
  return hex.replace(/(.{4})(?=.)/g, '$1 ');
}

/** Pins a payee to one (network, address) pair: sha256("ARC:" or "ARC-TESTNET:" + lowercase(address)). */
export const payeeFingerprint = (network: string, address: string): string =>
  `sha256:${sha256Hex(`${network}:${address.toLowerCase()}`)}`;

/** ISO-8601 UTC at second precision, the only timestamp form allowed inside a seal. */
export const isoSeconds = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
