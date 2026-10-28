import { listAudit, verifyAudit } from '@twokey-arc/core';
import type { AuditEntry } from '@twokey-arc/seal';
import { AutoRefresh, VerifyChain } from '@/components/client';
import { displayUsdc, sealGroups, timeIst } from '@/lib/format';
import { explorerTx } from '@/lib/explorer';
import { cfg, db } from '@/lib/server';
import { pageOwner } from '@/lib/session';

export const dynamic = 'force-dynamic';

function line(e: AuditEntry): React.ReactNode {
  const d = e.data as Record<string, string | null | string[]>;
  const amt = (v: unknown) => (typeof v === 'string' ? displayUsdc(v) : '');
  switch (e.verb) {
    case 'mandate.activated':
      return `${e.actor_id} activated mandate v${d.version}`;
    case 'payment.requested':
      return `${e.actor_id} asked to pay ${amt(d.amount)}${d.memo ? ` · memo ${d.memo}` : ''}`;
    case 'policy.classified':
      return `Policy at ${d.stage}: ${d.lane} (${d.rule}${(d.failed_checks as string[] | undefined)?.length ? `: ${(d.failed_checks as string[]).join(', ')}` : ''})`;
    case 'approval.requested':
      return <>Waiting for a second key · sealed <span className="mono">{sealGroups(String(d.seal))}</span></>;
    case 'approval.approved':
      return `${e.actor_id} approved via ${d.via}`;
    case 'approval.consumed':
      return 'Executor re-verified the seal and consumed the approval';
    case 'approval.voided':
      return `Approval void: ${d.reason}${d.amount_from ? ` (amount ${d.amount_from} → ${d.amount_to})` : ''}`;
    case 'circle.transaction_created':
      return <>Circle transaction created · <span className="mono">{String(d.circle_transaction_id)}</span></>;
    case 'circle.state_changed':
      return `Circle state ${d.from} → ${d.to}`;
    case 'payment.completed':
      return (
        <>
          Paid · Circle tx <span className="mono">{String(d.circle_transaction_id).slice(0, 8)}…</span> · Arc tx{' '}
          {d.tx_hash ? (
            <a className="mono" href={explorerTx(String(d.tx_hash))} target="_blank" rel="noreferrer">
              {String(d.tx_hash).slice(0, 12)}… ↗
            </a>
          ) : (
            '—'
          )}{' '}
          · fee {amt(d.fee)}
        </>
      );
    default:
      return `${e.actor_type}:${e.actor_id} ${e.verb}`;
  }
}

export default async function AuditPage() {
  await pageOwner();
  const [entries, v] = await Promise.all([listAudit(db(), cfg.orgId), verifyAudit(db(), cfg.orgId)]);
  return (
    <>
      <AutoRefresh ms={4000} />
      <div className="head">
        <div>
          <h1>Audit log</h1>
          <p>Append-only and hash-chained: each entry hashes the one before it. Export: /api/v1/audit/export</p>
        </div>
        <VerifyChain initial={v} />
      </div>
      <div className="page card">
        {[...entries].reverse().map((e) => (
          <div key={e.seq} className="audit-line">
            <span className="seq">#{e.seq}</span>
            <time>{timeIst(e.at)}</time>
            <div>
              <div>
                {line(e)} <span className="mono" style={{ color: 'var(--faint)' }}>· {e.subject_id}</span>
              </div>
              <div className="h">
                {e.verb} · {e.entry_hash.slice(0, 23)}… ← {e.prev_hash.slice(0, 15)}…
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
