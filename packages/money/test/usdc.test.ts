import { describe, expect, it } from 'vitest';
import {
  addUsdc,
  compareUsdc,
  displayUsdc,
  formatUsdc6,
  InvalidAmountError,
  isUsdcString,
  parseUsdc,
  toUsdc6,
} from '../src';

describe('parseUsdc', () => {
  it.each([
    ['25', 25_000_000n],
    ['25.00', 25_000_000n],
    ['0.25', 250_000n],
    ['0.000001', 1n],
    ['50.000001', 50_000_001n],
    ['0', 0n],
  ])('%s -> %s micro-units', (input, micro) => {
    expect(parseUsdc(input)).toBe(micro);
  });

  it.each([['-1'], ['25.1234567'], ['1e3'], ['.5'], ['5.'], [' 5'], ['+5'], ['0x10'], ['']])('rejects %j', (input) => {
    expect(() => parseUsdc(input)).toThrow(InvalidAmountError);
  });

  it('rejects JS numbers, so a float can never become money', () => {
    expect(() => parseUsdc(25.5)).toThrow(InvalidAmountError);
    expect(() => parseUsdc(null)).toThrow(/invalid_amount/);
  });
});

describe('formatting', () => {
  it('formats micro-units to exactly 6 decimals', () => {
    expect(formatUsdc6(25_000_000n)).toBe('25.000000');
    expect(formatUsdc6(1n)).toBe('0.000001');
    expect(formatUsdc6(-1_500_000n)).toBe('-1.500000');
  });

  it('normalizes strings', () => {
    expect(toUsdc6('25.5')).toBe('25.500000');
  });

  it('renders for people with at least 2 decimals', () => {
    expect(displayUsdc('25.000000')).toBe('USDC 25.00');
    expect(displayUsdc('0.25')).toBe('USDC 0.25');
    expect(displayUsdc('50.000001')).toBe('USDC 50.000001');
    expect(displayUsdc(750_000n)).toBe('USDC 0.75');
  });
});

describe('arithmetic', () => {
  it('adds without float drift', () => {
    expect(addUsdc('0.1', '0.2')).toBe('0.300000');
  });

  it('compares', () => {
    expect(compareUsdc('50', '50.000000')).toBe(0);
    expect(compareUsdc('50.000001', '50')).toBe(1);
    expect(compareUsdc('1', '2')).toBe(-1);
  });

  it('isUsdcString guards input', () => {
    expect(isUsdcString('1.5')).toBe(true);
    expect(isUsdcString(1.5)).toBe(false);
    expect(isUsdcString('1.1234567')).toBe(false);
  });
});
