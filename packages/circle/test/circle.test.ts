import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BadRequestError, InternalServerError } from '@circle-fin/developer-controlled-wallets';
import { arcNetwork, ARC_TESTNET, circleClientFromEnv, classifyCircleError, decimalToUsdc6, pickUsdcBalance, verifyWithPublicKey } from '../src';

const USDC = '0x3600000000000000000000000000000000000000';

describe('units', () => {
  it('rounds fees up and balances down to 6 dp', () => {
    expect(decimalToUsdc6('0.002100000000000001', 'up')).toBe('0.002101');
    expect(decimalToUsdc6('0.002100000000000001', 'down')).toBe('0.002100');
    expect(decimalToUsdc6('10', 'down')).toBe('10.000000');
    expect(decimalToUsdc6('0.0021', 'up')).toBe('0.002100');
    expect(() => decimalToUsdc6('-1', 'up')).toThrow();
  });
});

describe('one USDC balance on Arc', () => {
  const erc20 = { amount: '12.5', token: { tokenAddress: USDC, symbol: 'USDC', isNative: false } };
  const native = { amount: '12.500000000000000000', token: { symbol: 'USDC', isNative: true } };

  it('prefers the ERC-20 view and never sums the two views', () => {
    expect(pickUsdcBalance([native, erc20], USDC)).toBe('12.500000');
  });

  it('falls back to the native entry when only it is listed', () => {
    expect(pickUsdcBalance([native], USDC)).toBe('12.500000');
  });

  it('is zero when there is no USDC', () => {
    expect(pickUsdcBalance([{ amount: '3', token: { symbol: 'EURC', isNative: false, tokenAddress: '0x89b5' } }], USDC)).toBe('0.000000');
  });
});

describe('errors', () => {
  it('4xx is rejected, 5xx is ambiguous, anything else is ambiguous', () => {
    expect(classifyCircleError(new BadRequestError({ url: '/x', method: 'POST', status: 400 })).kind).toBe('rejected');
    expect(classifyCircleError(new InternalServerError({ url: '/x', method: 'POST', status: 500 })).kind).toBe('ambiguous');
    expect(classifyCircleError(new Error('socket hang up')).kind).toBe('ambiguous');
  });
});

describe('network guard', () => {
  it('defaults to Arc Testnet; mainnet needs both deliberate settings', () => {
    expect(arcNetwork({}).chainId).toBe(5042002);
    expect(ARC_TESTNET.circleBlockchain).toBe('ARC-TESTNET');
    expect(() => arcNetwork({ TWOKEY_NETWORK: 'mainnet' })).toThrow(/TWOKEY_ALLOW_MAINNET/);
    const main = arcNetwork({ TWOKEY_NETWORK: 'mainnet', TWOKEY_ALLOW_MAINNET: 'i-understand-real-usdc' });
    expect([main.circleBlockchain, main.chainId, main.explorerUrl]).toEqual(['ARC', 5042, 'https://explorer.arc.io']);
    expect(() => arcNetwork({ TWOKEY_NETWORK: 'devnet' })).toThrow();
  });

  it('keeps TEST and LIVE keys apart', () => {
    const secret = 'a'.repeat(64);
    expect(() => circleClientFromEnv({ CIRCLE_API_KEY: 'LIVE_API_KEY:x:y', CIRCLE_ENTITY_SECRET: secret })).toThrow(/expects a TEST_API_KEY/);
    expect(() => circleClientFromEnv({ TWOKEY_NETWORK: 'mainnet', CIRCLE_API_KEY: 'TEST_API_KEY:x:y', CIRCLE_ENTITY_SECRET: secret })).toThrow(/CIRCLE_LIVE_API_KEY/);
    expect(() => circleClientFromEnv({ TWOKEY_NETWORK: 'mainnet', CIRCLE_LIVE_API_KEY: 'TEST_API_KEY:x:y', CIRCLE_LIVE_ENTITY_SECRET: secret })).toThrow(/expects a LIVE_API_KEY/);
  });
});

describe('webhook signature', () => {
  it('verifies an ECDSA P-256 / SHA-256 signature over the raw body', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const body = JSON.stringify({ notificationId: 'n1', notificationType: 'transactions.outbound' });
    const sig = sign('sha256', Buffer.from(body), privateKey).toString('base64');
    const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(verifyWithPublicKey(pub, body, sig)).toBe(true);
    expect(verifyWithPublicKey(pub, `${body} `, sig)).toBe(false);
    expect(verifyWithPublicKey('not-a-key', body, sig)).toBe(false);
  });
});
