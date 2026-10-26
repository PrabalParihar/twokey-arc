/**
 * USDC on Arc, in the 6-decimal ERC-20 view only.
 *
 * Arc's native balance (18 dp) and the USDC ERC-20 at 0x3600…0000 (6 dp) are one pool of funds.
 * This module knows only the 6-dp view, so nothing here can add the two together.
 * Amounts travel as decimal strings and are computed as bigint micro-units; JS numbers never touch money.
 */

export const USDC_DECIMALS = 6;
export const USDC_ARC_ADDRESS = '0x3600000000000000000000000000000000000000';

const SCALE = 10n ** BigInt(USDC_DECIMALS);
const DECIMAL = /^(\d+)(?:\.(\d{1,6}))?$/;

export class InvalidAmountError extends Error {
  constructor(readonly input: unknown) {
    super(`invalid_amount: ${JSON.stringify(input)}`);
    this.name = 'InvalidAmountError';
  }
}

/** True for a non-negative decimal string with at most 6 decimals ("25", "25.5", "0.000001"). */
export function isUsdcString(input: unknown): input is string {
  return typeof input === 'string' && DECIMAL.test(input);
}

/** Parses a decimal string into micro-units. Rejects numbers, negatives, exponents and a 7th decimal. */
export function parseUsdc(input: unknown): bigint {
  if (typeof input !== 'string') throw new InvalidAmountError(input);
  const match = DECIMAL.exec(input);
  if (!match) throw new InvalidAmountError(input);
  const whole = match[1] as string;
  const frac = (match[2] ?? '').padEnd(USDC_DECIMALS, '0');
  return BigInt(whole) * SCALE + BigInt(frac);
}

/** Micro-units to the canonical 6-dp string ("25.000000"). Negative values keep their sign. */
export function formatUsdc6(micro: bigint): string {
  const sign = micro < 0n ? '-' : '';
  const abs = micro < 0n ? -micro : micro;
  const frac = (abs % SCALE).toString().padStart(USDC_DECIMALS, '0');
  return `${sign}${abs / SCALE}.${frac}`;
}

/** Normalizes any valid amount string to exactly 6 decimals ("25.5" -> "25.500000"). */
export function toUsdc6(input: string): string {
  return formatUsdc6(parseUsdc(input));
}

/**
 * For people: "USDC 25.00", "USDC 0.25", "USDC 50.000001".
 * Shows at least 2 decimals and drops trailing zeros beyond that.
 */
export function displayUsdc(amount: string | bigint): string {
  const six = typeof amount === 'bigint' ? formatUsdc6(amount) : toUsdc6(amount);
  const [whole, frac = ''] = six.split('.');
  const trimmed = frac.replace(/0+$/, '').padEnd(2, '0');
  return `USDC ${whole}.${trimmed}`;
}

export const addUsdc = (a: string, b: string): string => formatUsdc6(parseUsdc(a) + parseUsdc(b));

/** -1, 0 or 1, like a comparator. */
export function compareUsdc(a: string, b: string): -1 | 0 | 1 {
  const x = parseUsdc(a);
  const y = parseUsdc(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
