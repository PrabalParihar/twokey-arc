import Link from 'next/link';
import type { ApprovalRow, IntentRow } from '@twokey-arc/core';
import type { attempts } from '@twokey-arc/db';
import type { AuditEntry, BoundTerms } from '@twokey-arc/seal';
import { ApprovalActions, CopyButton, DriftButton } from './client';
import { displayUsdc, sealGroups, shortAddr, statusChip, timeIst } from '@/lib/format';
import { explorerAddress, explorerTx } from '@/lib/explorer';

type AttemptRow = typeof attempts.$inferSelect;
type CheckT = { id: string; pass: boolean; detail: string };

const RULE_LINE: Record<string, string> = {
  'R-WM-PAY': 'Inside your mandate',
  'R-EX-PAY': 'Outside your mandate: needs your key',
  'INV-PAYEE-PINNED': 'Known payee, different address: blocked, no override',
};

function feedLine(e: AuditEntry): { text: string; cls: string } {
  const d = e.data as Record<string, string | null>;
  switch (e.verb) {
    case 'payment.requested':
      return { text: `${e.actor_id} asked to pay ${displayUsdc(String(d.amount))}`, cls: '' };
    case 'policy.classified':
      return { text: `Policy (${d.stage}): ${d.lane} · ${d.rule}`, cls: '' };
    case 'approval.requested':
      return { text: `Waiting for a second key · sealed ${sealGroups(String(d.seal))}`, cls: 'hot' };
    case 'approval.approved':
      return { text: `Approved by ${e.actor_id} via ${d.via}`, cls: 'hot' };
    case 'approval.rejected':
      return { text: `Rejected by ${e.actor_id}: ${d.reason}`, cls: '' };
    case 'approval.voided':
      return { text: `Approval void: ${d.reason}`, cls: '' };
    case 'attempt.created':
      return { text: 'Attempt written ahead, idempotency key fixed', cls: '' };
    case 'circle.transaction_created':
      return { text: `Circle transaction ${String(d.circle_transaction_id).slice(0, 8)}… created`, cls: '' };
    case 'circle.state_changed':
      return { text: `Circle: ${d.from} → ${d.to}`, cls: '' };
    case 'payment.completed':
      return { text: `Paid on Arc · fee ${d.fee ? displayUsdc(String(d.fee)) : 'n/a'}`, cls: 'good' };
    case 'payment.failed':
      return { text: `Failed: ${d.state ?? d.error_code}`, cls: '' };
    case 'demo.drift':
      return { text: `Agent changed the amount ${d.amount_from} → ${d.amount_to}`, cls: '' };
    default:
      return { text: e.verb, cls: '' };
  }
}

export function PaymentDetail(props: {
  intent: IntentRow;
  approval: ApprovalRow | null;
  attempt: AttemptRow | null;
  feed: AuditEntry[];
  csrf: string;
  treasury: string | null;
  demoMode: boolean;
  networkLabel: string;
}) {
  const { intent: i, approval: a, attempt: at, feed } = props;
  const chip = statusChip(i.status);
  const checks = i.checks as CheckT[];
  const terms = a?.boundTerms as BoundTerms | undefined;
  const pendingApproval = a?.status === 'PENDING';
  const expiresMin = a ? Math.max(0, Math.round((a.expiresAt.getTime() - Date.now()) / 60_000)) : 0;
  const voidDetail = a?.voidDetail as { amount_from?: string; amount_to?: string; fields?: string[] } | null;

  return (
    <section className="detail" aria-label="Payment detail">
      <div className="d-top">
        <span>Accounts payable agent · {timeIst(i.createdAt)} IST</span>
        {pendingApproval ? <span>Expires in {expiresMin} min</span> : <span className={`st ${chip.cls}`}>{chip.label}</span>}
      </div>
      <h2>Pay {i.payeeName ?? (i.destinationAddress ? shortAddr(i.destinationAddress) : 'unknown payee')}</h2>
      <div className="amt">{displayUsdc(i.amount)}</div>

      <div className="d-sec">
        <span>Why it&apos;s {i.lane === 'ADDS_RISK' ? 'here' : i.lane === 'BREAKS_RULE' ? 'blocked' : 'running'}</span>
        <code className="rule">{i.ruleId}</code>
      </div>
      <ul className="trace">
        {i.lane === 'BREAKS_RULE' ? (
          <li className="no">
            <i>×</i>
            {checks[0]?.detail ?? RULE_LINE[i.ruleId] ?? i.ruleId}
          </li>
        ) : (
          checks.map((c) => (
            <li key={c.id} className={c.pass ? 'ok' : 'ask'}>
              <i>{c.pass ? '✓' : '!'}</i>
              {c.detail}
            </li>
          ))
        )}
        {i.lane === 'ADDS_RISK' && (
          <li className="ok">
            <i>✓</i>No hard rule broken
          </li>
        )}
      </ul>

      <table className="terms">
        <tbody>
          <tr>
            <td>Payee</td>
            <td>{i.payeeName ?? 'New payee'}{i.resolvedPayeeId ? ' · pinned' : ''}</td>
          </tr>
          <tr>
            <td>Address</td>
            <td>
              {i.destinationAddress ? (
                <span className="addr">
                  <a href={explorerAddress(i.destinationAddress)} title={i.destinationAddress} target="_blank" rel="noreferrer">
                    {shortAddr(i.destinationAddress)}
                  </a>
                  <CopyButton text={i.destinationAddress} />
                </span>
              ) : (
                '—'
              )}
            </td>
          </tr>
          <tr>
            <td>Network</td>
            <td>{props.networkLabel}</td>
          </tr>
          <tr>
            <td>From</td>
            <td className="mono">Treasury {shortAddr(props.treasury)}</td>
          </tr>
          <tr>
            <td>Memo</td>
            <td>{i.memo ?? '—'}</td>
          </tr>
          {at?.circleTransactionId && (
            <tr>
              <td>Circle tx</td>
              <td className="mono">{at.circleTransactionId}</td>
            </tr>
          )}
        </tbody>
      </table>

      {a && (
        <div className="seal">
          Sealed to these terms · <b>{sealGroups(a.seal)}</b>
        </div>
      )}

      {i.status === 'PAID' && at?.txHash && (
        <div className="note paid">
          Paid ·{' '}
          <a href={explorerTx(at.txHash)} target="_blank" rel="noreferrer">
            tx {at.txHash.slice(0, 10)}… ↗
          </a>
        </div>
      )}
      {(i.status === 'QUEUED' || i.status === 'SUBMITTED') && <div className="note">{i.approved ? 'Approved · sending on Arc…' : 'Inside the mandate · sending on Arc…'}</div>}
      {i.status === 'BLOCKED' && <div className="note block">Refused before it reached Circle. Nothing was sent, and no approval can override it.</div>}
      {i.status === 'VOIDED' && (
        <div className="note void">
          This approval no longer matches
          {voidDetail?.amount_from ? `: the amount changed from ${displayUsdc(voidDetail.amount_from).slice(5)} to ${displayUsdc(voidDetail.amount_to!).slice(5)}` : `: ${a?.voidReason ?? 'terms changed'}`}. Nothing was sent.
        </div>
      )}
      {i.status === 'REJECTED' && <div className="note block">Rejected: {a?.rejectReason}. Nothing was sent.</div>}
      {i.status === 'EXPIRED' && <div className="note void">The approval window closed. Nothing was sent.</div>}
      {i.status === 'FAILED' && <div className="note block">Circle reported a failure. Not retried automatically.</div>}
      {i.status === 'NEEDS_HUMAN' && <div className="note wait">Circle&apos;s answer was unclear after retries with the same key. Check the treasury in the Circle console.</div>}

      {pendingApproval && a && <ApprovalActions approvalId={a.id} paymentId={i.id} seal={a.seal} csrf={props.csrf} />}
      {props.demoMode && a && (a.status === 'PENDING' || a.status === 'APPROVED') && <DriftButton paymentId={i.id} csrf={props.csrf} />}
      {!pendingApproval && a && terms && i.status === 'AWAITING_APPROVAL' && (
        <p className="hint">
          <Link href={`/app/approvals/${a.id}`}>Open the approval</Link>
        </p>
      )}

      <div className="d-sec">
        <span>Record</span>
        <Link className="hint" href="/app/audit">
          Audit log →
        </Link>
      </div>
      <ul className="feed">
        {feed.map((e) => {
          const f = feedLine(e);
          return (
            <li key={e.seq} className={f.cls}>
              <time>{timeIst(e.at)}</time>
              {f.text}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
