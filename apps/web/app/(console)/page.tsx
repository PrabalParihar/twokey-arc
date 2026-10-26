import Link from 'next/link';
import { auditForPayment, getActiveMandate, listPayments } from '@twokey-arc/core';
import { AutoRefresh } from '@/components/client';
import { PaymentDetail } from '@/components/payment-detail';
import { displayUsdc, reasonLine, statusChip, timeIst } from '@/lib/format';
import { explorerTx } from '@/lib/explorer';
import { cfg, db } from '@/lib/server';
import { pageOwner } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Today({ searchParams }: { searchParams: Promise<{ id?: string; view?: string }> }) {
  const { csrf } = await pageOwner();
  const sp = await searchParams;
  const pendingOnly = sp.view === 'pending';
  const rows = await listPayments(db(), cfg.orgId, { limit: 60, ...(pendingOnly ? { status: 'AWAITING_APPROVAL' } : {}) });
  const selected = rows.find((r) => r.intent.id === sp.id) ?? rows.find((r) => r.intent.status === 'AWAITING_APPROVAL') ?? rows[0];
  const mandate = await getActiveMandate(db(), cfg.orgId);
  const feed = selected ? await auditForPayment(db(), cfg.orgId, selected.intent.id) : [];
  const paid = rows.filter((r) => r.intent.status === 'PAID').length;
  const waiting = rows.filter((r) => r.intent.status === 'AWAITING_APPROVAL').length;

  return (
    <>
      <AutoRefresh />
      <div className="head">
        <div>
          <h1>{pendingOnly ? 'Needs you' : 'Today'}</h1>
          <p>
            {rows.length} requests · {paid} paid · {waiting} waiting for you · times in IST
          </p>
        </div>
      </div>
      <div className="split">
        <ul className="rows">
          {rows.length === 0 && <li className="empty">No payment requests yet. Run the demo agent: pnpm demo:agent</li>}
          {rows.map(({ intent: i, attempt }) => {
            const chip = statusChip(i.status);
            const href = `/?${new URLSearchParams({ ...(pendingOnly ? { view: 'pending' } : {}), id: i.id })}`;
            return (
              <li key={i.id} className={`row${selected?.intent.id === i.id ? ' sel' : ''}`}>
                <time dateTime={i.createdAt.toISOString()}>{timeIst(i.createdAt)}</time>
                <Link className="t" href={href} aria-current={selected?.intent.id === i.id ? 'true' : undefined}>
                  Pay {i.payeeName ?? 'new payee'} · {displayUsdc(i.amount)}
                </Link>
                <span className="m">
                  {reasonLine(i)}
                  {attempt?.txHash && (
                    <>
                      {' · '}
                      <a href={explorerTx(attempt.txHash)} target="_blank" rel="noreferrer">
                        Arc tx ↗
                      </a>
                    </>
                  )}
                </span>
                <span className={`st ${chip.cls}`}>{chip.label}</span>
              </li>
            );
          })}
        </ul>
        {selected ? (
          <PaymentDetail
            intent={selected.intent}
            approval={selected.approval}
            attempt={selected.attempt}
            feed={feed}
            csrf={csrf}
            treasury={mandate?.source_wallet.address ?? null}
            demoMode={cfg.demoMode}
            networkLabel={`Arc Testnet (${cfg.chainId})`}
          />
        ) : (
          <div />
        )}
      </div>
    </>
  );
}
