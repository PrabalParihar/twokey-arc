import { displayUsdc } from '@twokey-arc/money';
import { sealGroups } from '@twokey-arc/seal';

export { displayUsdc, sealGroups };

const ist = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const istFull = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export const timeIst = (d: Date | string) => ist.format(new Date(d));
export const dateTimeIst = (d: Date | string) => `${istFull.format(new Date(d))} IST`;
export const shortAddr = (a: string | null | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

/** The four chips the site uses, plus the in-between states, never color alone: each has a word. */
export function statusChip(status: string): { cls: string; label: string } {
  switch (status) {
    case 'PAID':
      return { cls: 'paid', label: 'Paid' };
    case 'AWAITING_APPROVAL':
      return { cls: 'wait', label: 'Needs you' };
    case 'BLOCKED':
      return { cls: 'block', label: 'Blocked' };
    case 'QUEUED':
    case 'SUBMITTED':
      return { cls: 'run', label: 'Sending' };
    case 'UNCONFIRMED':
      return { cls: 'wait', label: 'Checking' };
    case 'NEEDS_HUMAN':
      return { cls: 'block', label: 'Check by hand' };
    case 'VOIDED':
      return { cls: 'void', label: 'Void' };
    case 'REJECTED':
      return { cls: 'block', label: 'Rejected' };
    case 'EXPIRED':
      return { cls: 'void', label: 'Expired' };
    case 'CANCELLED':
      return { cls: 'void', label: 'Cancelled' };
    case 'FAILED':
      return { cls: 'block', label: 'Failed' };
    default:
      return { cls: 'void', label: status };
  }
}

const CHECK_TEXT: Record<string, string> = {
  'INV-PAYEE-PINNED': 'Known payee at a new address',
  'INV-ADDRESS': 'Invalid destination',
  'INV-HARD-MAX': 'Over the hard maximum',
  'INV-FUNDS': 'Not enough USDC',
  'INV-NETWORK': 'Unsupported network',
  'INV-AMOUNT': 'Invalid amount',
  'INV-NO-MANDATE': 'No active mandate',
  'INV-DUPLICATE': 'Already in flight',
};

/** One line under the action in the timeline: why it landed in its lane. */
export function reasonLine(i: { lane: string; ruleId: string; checks: unknown; resolvedPayeeId: string | null }): string {
  const failed = (i.checks as { id: string; pass: boolean; detail: string }[]).filter((c) => !c.pass);
  if (i.lane === 'BREAKS_RULE') return CHECK_TEXT[i.ruleId] ?? i.ruleId;
  if (i.lane === 'ADDS_RISK') return failed.map((c) => c.detail).join(' · ');
  return `${i.resolvedPayeeId ? 'Known payee' : 'Payee'} · inside your mandate`;
}
