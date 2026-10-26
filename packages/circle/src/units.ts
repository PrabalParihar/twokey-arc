import { formatUsdc6 } from '@twokey-arc/money';

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Circle reports fees and native balances as decimal strings that can carry up to 18 decimals
 * (Arc's native view of USDC). Converts to the 6-dp USDC view: fees round UP (never under-reserve),
 * balances round DOWN (never overstate what can be spent).
 */
export function decimalToUsdc6(input: string, rounding: 'up' | 'down'): string {
  const m = DECIMAL.exec(input.trim());
  if (!m) throw new Error(`not a decimal amount: ${JSON.stringify(input)}`);
  const frac = m[2] ?? '';
  let micro = BigInt(m[1]!) * 1_000_000n + BigInt((frac.slice(0, 6) || '0').padEnd(6, '0'));
  if (rounding === 'up' && /[1-9]/.test(frac.slice(6))) micro += 1n;
  return formatUsdc6(micro);
}
