import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { agents } from '@twokey-arc/db';
import { auditForPayment, autoSpentToday, getActiveMandate, latestBalance, listPayments } from '@twokey-arc/core';
import { AutoRefresh } from '@/components/client';
import { Inbox, laneOf } from '@/components/inbox';
import { PaymentDetail } from '@/components/payment-detail';
import { displayUsdc, networkName, reasonLine, shortAddr, timeIst } from '@/lib/format';
import { publicStats } from '@/lib/public-stats';
import { cfg, db } from '@/lib/server';
import { pageOwner } from '@/lib/session';

export const dynamic = 'force-dynamic';

const num = (a: string) => displayUsdc(a).replace(/^USDC\s*/, '');
const two = (a: string | number) => Number(a).toFixed(2);
const startOfIstDay = (d: Date) => new Date(Math.floor((d.getTime() + 19_800_000) / 86_400_000) * 86_400_000 - 19_800_000);

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ id?: string; view?: string }> }) {
  const { csrf } = await pageOwner();
  const sp = await searchParams;
  const pendingOnly = sp.view === 'pending';
  const now = new Date();
  const [all, mandate, stats, agentRows] = await Promise.all([
    listPayments(db(), cfg.orgId, { limit: 80 }),
    getActiveMandate(db(), cfg.orgId),
    publicStats(cfg.orgId).catch(() => null),
    db().select().from(agents).where(and(eq(agents.orgId, cfg.orgId), eq(agents.status, 'ACTIVE'))),
  ]);
  const [bal, spent] = mandate
    ? await Promise.all([latestBalance(db(), mandate.source_wallet.circle_wallet_id), autoSpentToday(db(), cfg.orgId, mandate.timezone, now)])
    : [null, '0'];
  const rows = pendingOnly ? all.filter((r) => r.intent.status === 'AWAITING_APPROVAL') : all;
  const selected = all.find((r) => r.intent.id === sp.id) ?? all.find((r) => r.intent.status === 'AWAITING_APPROVAL') ?? all[0];
  const feed = selected ? await auditForPayment(db(), cfg.orgId, selected.intent.id) : [];
  const today = all.filter((r) => r.intent.createdAt >= startOfIstDay(now));
  const link = (id: string) => `/app?${new URLSearchParams({ ...(pendingOnly ? { view: 'pending' } : {}), id })}`;
  const used = mandate ? Math.min(1, Number(spent) / Number(mandate.limits.daily)) : 0;

  return (
    <>
      <AutoRefresh />
      <section className="stats" aria-label="Today">
        <div>
          <b>{today.length}</b>requests today
        </div>
        <div>
          <b>
            {two(spent)}
            <em>/ {mandate ? two(mandate.limits.daily) : '—'}</em>
          </b>
          auto-paid today
        </div>
        <div>
          <b>
            {stats?.last ? stats.last.seconds.toFixed(1) : '—'}
            <em>s</em>
          </b>
          request to final on Arc
        </div>
        <div>
          <b>{stats ? stats.audit.length : '—'}</b>
          audit entries{stats ? (stats.audit.ok ? ', intact' : ', broken') : ''}
        </div>
      </section>

      <section className="wallet" aria-label="Treasury and agents">
        <div className="wcard treasury">
          <div className="t">
            <span>Treasury</span>
            <span className="mono">{shortAddr(mandate?.source_wallet.address)}</span>
          </div>
          <b>
            {bal ? two(bal.usdc) : '—'}
            <em>USDC</em>
          </b>
          <small>
            Circle wallet on {networkName(cfg.network)}
            {mandate ? ` · ${two(mandate.limits.min_balance_after)} kept for gas` : ''}
          </small>
        </div>
        {agentRows.length === 0 ? (
          <Link className="wcard" href="/app/mandate">
            <div className="t">
              <span>No agent yet</span>
            </div>
            <small>Issue the accounts payable agent a key on the Mandate page.</small>
          </Link>
        ) : (
          agentRows.slice(0, 2).map((a) => (
            <div className="wcard" key={a.id}>
              <div className="t">
                <span>{a.agentId}</span>
                <span className="mono">{a.name}</span>
              </div>
              <div>
                <small>
                  {two(spent)} of {mandate ? two(mandate.limits.daily) : '—'} today · {mandate ? two(mandate.limits.per_tx) : '—'} per payment
                </small>
                <div className="capbar">
                  <i style={{ width: `${Math.round(used * 100)}%` }} />
                </div>
              </div>
              <small>{all.filter((r) => r.intent.agentId === a.agentId && r.intent.status === 'AWAITING_APPROVAL').length} waiting for you</small>
            </div>
          ))
        )}
        {mandate && (
          <Link className="wcard lime" href="/app/mandate">
            <div className="t">
              <span>Mandate v{mandate.version}</span>
              <span>↗</span>
            </div>
            <b>
              {two(mandate.limits.per_tx)}
              <em>per payment</em>
            </b>
            <small>
              {mandate.payees.length} pinned payees · hard max {two(mandate.limits.hard_max_per_tx)}
            </small>
          </Link>
        )}
        <div className="wcard holo">
          <div className="t">
            <span>+ Agent card</span>
            <span className="mono">next</span>
          </div>
          <small>A card per agent, each authorization asking this mandate first.</small>
        </div>
      </section>

      <div className="desk">
        <section aria-label={pendingOnly ? 'Needs your signature' : 'Agent inbox'}>
          <Inbox
            per={6}
            items={rows.map(({ intent: i, attempt }) => ({
              id: i.id,
              payee: i.payeeName ?? 'New payee',
              amount: num(i.amount),
              lane: laneOf(i.status),
              note: reasonLine(i),
              meta: attempt?.txHash ? <span className="mono">{`${attempt.txHash.slice(0, 8)}…${attempt.txHash.slice(-4)}`}</span> : `${timeIst(i.createdAt)} · ${i.agentId}`,
              href: link(i.id),
              selected: selected?.intent.id === i.id,
            }))}
          />
        </section>
        <div className="side-col">
          {selected ? (
            <PaymentDetail
              intent={selected.intent}
              approval={selected.approval}
              attempt={selected.attempt}
              feed={feed}
              csrf={csrf}
              treasury={mandate?.source_wallet.address ?? null}
              demoMode={cfg.demoMode}
              networkLabel={`${networkName(cfg.network)} (${cfg.chainId})`}
            />
          ) : (
            <section className="sheet">
              <b>Nothing yet</b>
              <p className="card-sub">When the agent asks to pay, the request lands in the inbox. Anything outside the mandate waits here, sealed, for your signature.</p>
            </section>
          )}
          {mandate && (
            <section className="card" aria-label="Mandate, per payee">
              <div className="card-h">
                <h3>Mandate, per payee</h3>
                <Link href="/app/mandate">v{mandate.version} ↗</Link>
              </div>
              <div className="perm-rows" style={{ marginTop: 8 }}>
                {mandate.payees.map((p) => (
                  <div className="perm-row" key={p.payee_id}>
                    <span>
                      {p.name}
                      <small>{shortAddr(p.address)}</small>
                    </span>
                    <span className="perm" aria-label={`Runs on its own up to ${two(p.per_tx_override ?? mandate.limits.per_tx)}`}>
                      <span className="on">✓ up to {two(p.per_tx_override ?? mandate.limits.per_tx)}</span>
                      <span>✋</span>
                      <span>⊘</span>
                    </span>
                  </div>
                ))}
                <div className="perm-row">
                  <span>
                    A new payee
                    <small>or over a cap</small>
                  </span>
                  <span className="perm" aria-label="Needs your signature">
                    <span>✓</span>
                    <span className="on">✋ Needs you</span>
                    <span>⊘</span>
                  </span>
                </div>
                <div className="perm-row">
                  <span>
                    A pinned name, other address
                    <small>or over {two(mandate.limits.hard_max_per_tx)}</small>
                  </span>
                  <span className="perm" aria-label="Blocked">
                    <span>✓</span>
                    <span>✋</span>
                    <span className="on">⊘ Blocked</span>
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
