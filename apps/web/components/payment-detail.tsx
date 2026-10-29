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

const usdcNum = (a: string) => displayUsdc(a).replace(/^USDC\s*/, '');

function headline(status: string, approved: boolean): string {
  switch (status) {
    case 'AWAITING_APPROVAL':
      return 'Needs your signature';
    case 'QUEUED':
    case 'SUBMITTED':
      return approved ? 'Signed, sending on Arc' : 'Inside the mandate, sending';
    case 'PAID':
      return approved ? 'Paid with your signature' : 'Paid on its own';
    case 'BLOCKED':
      return 'Stopped before Circle';
    case 'VOIDED':
      return 'Void: the terms changed';
    case 'REJECTED':
      return 'Rejected';
    case 'EXPIRED':
      return 'Expired unsigned';
    default:
      return 'Payment';
  }
}

/** The sheet: one payment, why it landed where it did, and (if it waits for you) the hold to sign it. */
export function PaymentDetail(props: {
  intent: IntentRow;
  approval: ApprovalRow | null;
  attempt: AttemptRow | null;
  feed: AuditEntry[];
  csrf: string;
  treasury: string | null;
  demoMode: boolean;
  networkLabel: string;
  /** The Arc explorer of the workspace's network: a sandbox is on testnet even when this deployment is on mainnet. */
  explorer: string;
}) {
  const { intent: i, approval: a, attempt: at, feed } = props;
  const chip = statusChip(i.status);
  const checks = i.checks as CheckT[];
  const terms = a?.boundTerms as BoundTerms | undefined;
  const pendingApproval = a?.status === 'PENDING';
  const expiresMin = a ? Math.max(0, Math.round((a.expiresAt.getTime() - Date.now()) / 60_000)) : 0;
  const voidDetail = a?.voidDetail as { amount_from?: string; amount_to?: string; fields?: string[] } | null;
  const name = i.payeeName ?? (i.destinationAddress ? shortAddr(i.destinationAddress) : 'Unknown payee');

  return (
    <section className={`sheet${i.status === 'VOIDED' ? ' is-void' : ''}`} aria-label="Payment detail">
      <div className="sh-top">
        <span>
          {i.agentId} · {timeIst(i.createdAt)} IST
        </span>
        {pendingApproval ? <span className="st wait">Needs your signature · {expiresMin} min</span> : <span className={`st ${chip.cls}`}>{headline(i.status, i.approved)}</span>}
      </div>
      <div className="sh-who">
        <span className="monogram">{name.replace(/^"/, '').slice(0, 1).toUpperCase()}</span>
        <div>
          <b>{name}</b>
          <small>
            {i.resolvedPayeeId ? 'pinned payee' : 'new payee'}
            {i.destinationAddress && (
              <>
                {' · '}
                <a href={explorerAddress(i.destinationAddress, props.explorer)} title={i.destinationAddress} target="_blank" rel="noreferrer">
                  {shortAddr(i.destinationAddress)}
                </a>
              </>
            )}
            {i.memo ? ` · ${i.memo}` : ''}
          </small>
        </div>
      </div>
      <div className="sh-amt">
        {usdcNum(i.amount)}
        <em>USDC</em>
      </div>

      <table className="kv">
        <tbody>
          <tr>
            <td>Why</td>
            <td>
              <ul className="why" aria-label={`Rule ${i.ruleId}`}>
                {i.lane === 'BREAKS_RULE' ? (
                  <li className="no">{checks[0]?.detail ?? RULE_LINE[i.ruleId] ?? i.ruleId}</li>
                ) : checks.some((c) => !c.pass) ? (
                  checks
                    .filter((c) => !c.pass)
                    .map((c) => (
                      <li key={c.id} className="ask">
                        {c.detail}
                      </li>
                    ))
                ) : (
                  <li>{RULE_LINE[i.ruleId] ?? 'Inside your mandate'}</li>
                )}
              </ul>
            </td>
          </tr>
          {a && (
            <tr>
              <td>Seal</td>
              <td className="mono">{sealGroups(a.seal)}</td>
            </tr>
          )}
          <tr>
            <td>Network</td>
            <td>{props.networkLabel}</td>
          </tr>
          <tr>
            <td>From</td>
            <td className="mono">{shortAddr(props.treasury)}</td>
          </tr>
          {i.destinationAddress && (
            <tr>
              <td>To</td>
              <td>
                <span className="mono">{shortAddr(i.destinationAddress)}</span>
                <CopyButton text={i.destinationAddress} />
              </td>
            </tr>
          )}
          {at?.circleTransactionId && (
            <tr>
              <td>Circle tx</td>
              <td className="mono">{at.circleTransactionId.slice(0, 18)}…</td>
            </tr>
          )}
          <tr>
            <td>Rule</td>
            <td>
              <span className="rule">{i.ruleId}</span>
            </td>
          </tr>
        </tbody>
      </table>

      {i.status === 'PAID' && at?.txHash && (
        <div className="sh-note paid">
          Final on Arc ·{' '}
          <a href={explorerTx(at.txHash, props.explorer)} target="_blank" rel="noreferrer">
            tx {at.txHash.slice(0, 10)}…{at.txHash.slice(-4)}
          </a>
        </div>
      )}
      {(i.status === 'QUEUED' || i.status === 'SUBMITTED') && (
        <div className="sh-note">{i.approved ? 'Signed. Twokey checks the seal once more, then sends through the Circle wallet.' : 'Inside the mandate, sending through the Circle wallet.'}</div>
      )}
      {i.status === 'BLOCKED' && <div className="sh-note block">Refused before it reached Circle. Nothing was sent, and no approval can override it.</div>}
      {i.status === 'VOIDED' && (
        <div className="sh-note void">
          {voidDetail?.amount_from
            ? `The amount changed from ${usdcNum(voidDetail.amount_from)} to ${usdcNum(voidDetail.amount_to!)} after it was sealed`
            : `The terms changed after they were sealed (${a?.voidReason ?? 'terms changed'})`}
          . Nothing was sent.
        </div>
      )}
      {i.status === 'REJECTED' && <div className="sh-note block">Rejected: {a?.rejectReason}. Nothing was sent.</div>}
      {i.status === 'EXPIRED' && <div className="sh-note void">The approval window closed. Nothing was sent.</div>}
      {i.status === 'FAILED' && <div className="sh-note block">Circle reported a failure. Not retried automatically.</div>}
      {i.status === 'NEEDS_HUMAN' && <div className="sh-note">Circle&apos;s answer was unclear after retries with the same key. Check the treasury in the Circle console.</div>}

      {pendingApproval && a && <ApprovalActions approvalId={a.id} paymentId={i.id} seal={a.seal} csrf={props.csrf} />}
      {props.demoMode && a && (a.status === 'PENDING' || a.status === 'APPROVED') && <DriftButton paymentId={i.id} csrf={props.csrf} />}
      {!pendingApproval && a && terms && i.status === 'AWAITING_APPROVAL' && (
        <p className="f-acts">
          <Link href={`/app/approvals/${a.id}`}>Open the approval</Link>
        </p>
      )}

      <details className="sh-rec" open={feed.length <= 8}>
        <summary>
          Record · {feed.length} audit entries · <Link href="/app/audit">full log</Link>
        </summary>
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
      </details>
    </section>
  );
}
