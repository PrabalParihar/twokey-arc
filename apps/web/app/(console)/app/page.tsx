import Link from 'next/link';
import { auditForPayment, autoSpentToday, getActiveMandate, latestBalance, listPayments } from '@twokey-arc/core';
import { AgentDay, dayKind } from '@/components/agent-day';
import { AutoRefresh } from '@/components/client';
import { PaymentDetail } from '@/components/payment-detail';
import { displayUsdc, networkName, reasonLine, statusChip, timeIst } from '@/lib/format';
import { explorerTx } from '@/lib/explorer';
import { publicStats } from '@/lib/public-stats';
import { cfg, db, OWNER_NAME } from '@/lib/server';
import { pageOwner } from '@/lib/session';

export const dynamic = 'force-dynamic';

const num = (a: string) => displayUsdc(a).replace(/^USDC\s*/, '');
const istHour = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(d));
const greeting = (d: Date) => (istHour(d) < 12 ? 'Good morning' : istHour(d) < 17 ? 'Good afternoon' : 'Good evening');
const startOfIstDay = (d: Date) => new Date(Math.floor((d.getTime() + 19_800_000) / 86_400_000) * 86_400_000 - 19_800_000);

/** The half-ring that fills as the day's auto-paid total approaches the mandate's daily cap. */
function Gauge({ used, cap }: { used: number; cap: number }) {
  const f = cap > 0 ? Math.min(1, used / cap) : 0;
  const a = Math.PI * (1 - f);
  const x = 120 + 100 * Math.cos(a);
  const y = 120 - 100 * Math.sin(a);
  return (
    <div className="gauge">
      <svg viewBox="0 0 240 132" aria-hidden="true">
        <path d="M20 120a100 100 0 0 1 200 0" fill="none" stroke="#eef0f2" strokeWidth="22" strokeLinecap="round" />
        {f > 0 && <path d={`M20 120A100 100 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none" stroke="#121417" strokeWidth="22" strokeLinecap="round" />}
        {f < 1 && <path d={`M${x.toFixed(1)} ${y.toFixed(1)}A100 100 0 0 1 220 120`} fill="none" stroke="#a9cc1f" strokeWidth="8" strokeDasharray="3 7" />}
      </svg>
      <div className="v">
        <b>{Math.round(f * 100)}%</b>
        <small>{num(String(Math.max(0, cap - used)))} left to run on its own</small>
      </div>
    </div>
  );
}

export default async function Today({ searchParams }: { searchParams: Promise<{ id?: string; view?: string }> }) {
  const { csrf } = await pageOwner();
  const sp = await searchParams;
  const pendingOnly = sp.view === 'pending';
  const now = new Date();
  const [all, mandate, stats] = await Promise.all([listPayments(db(), cfg.orgId, { limit: 80 }), getActiveMandate(db(), cfg.orgId), publicStats(cfg.orgId).catch(() => null)]);
  const [bal, spent] = mandate
    ? await Promise.all([latestBalance(db(), mandate.source_wallet.circle_wallet_id), autoSpentToday(db(), cfg.orgId, mandate.timezone, now)])
    : [null, '0'];
  const rows = pendingOnly ? all.filter((r) => r.intent.status === 'AWAITING_APPROVAL') : all;
  const selected = all.find((r) => r.intent.id === sp.id) ?? all.find((r) => r.intent.status === 'AWAITING_APPROVAL') ?? all[0];
  const feed = selected ? await auditForPayment(db(), cfg.orgId, selected.intent.id) : [];

  const today = all.filter((r) => r.intent.createdAt >= startOfIstDay(now));
  const count = (f: (s: string) => boolean) => today.filter((r) => f(r.intent.status)).length;
  const paid = count((s) => s === 'PAID');
  const waiting = all.filter((r) => r.intent.status === 'AWAITING_APPROVAL').length;
  const stopped = count((s) => ['BLOCKED', 'VOIDED', 'REJECTED', 'EXPIRED'].includes(s));
  // After a quiet stretch, end the day's window at the latest request instead of showing it empty.
  const latest = all[0]?.intent.createdAt;
  const dayEnd = latest && now.getTime() - latest.getTime() > 7 * 3_600_000 ? new Date(latest.getTime() + 600_000) : now;
  const link = (id: string) => `/app?${new URLSearchParams({ ...(pendingOnly ? { view: 'pending' } : {}), id })}`;

  return (
    <>
      <AutoRefresh />
      <section className="hello">
        <div>
          <h1>
            {greeting(now)}, {OWNER_NAME}
          </h1>
          <div className="hello-pills">
            <span className="pill ink">{today.length} requests today</span>
            <span className="pill lime">{paid} paid on Arc</span>
            <Link className={`pill${waiting ? ' amber' : ''}`} href="/app?view=pending">
              {waiting} {waiting === 1 ? 'needs' : 'need'} your signature
            </Link>
            <span className="pill striped">{stopped} stopped before Circle</span>
          </div>
        </div>
        <div className="kpis">
          <div className="kpi">
            <small>Treasury</small>
            <b>
              {bal ? Number(bal.usdc).toFixed(2) : '—'}
              <em>USDC</em>
            </b>
          </div>
          <div className="kpi">
            <small>Auto-paid today</small>
            <b>
              {Number(spent).toFixed(2)}
              <em>/ {mandate ? Number(mandate.limits.daily).toFixed(2) : '—'}</em>
            </b>
          </div>
          <div className="kpi">
            <small>Request to final</small>
            <b>
              {stats?.last ? stats.last.seconds.toFixed(1) : '—'}
              <em>s</em>
            </b>
          </div>
        </div>
      </section>

      <div className="bento">
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
          <section className="focus">
            <div className="f-top">
              <b>Nothing waiting for you</b>
            </div>
            <p className="f-status" style={{ fontSize: 15, color: '#e7e9ec' }}>
              When the agent asks for something outside your mandate, it lands here, sealed, for your signature. Issue the agent a key on the Mandate page to start.
            </p>
          </section>
        )}

        <section className="card wide" aria-label="Your agent's day">
          <div className="card-h">
            <h3>Your agent&apos;s day</h3>
            <span>{dayEnd === now ? 'last eight hours, IST' : 'the last busy eight hours, IST'}</span>
          </div>
          <AgentDay
            now={dayEnd}
            items={all.map(({ intent: i, attempt }) => ({
              id: i.id,
              at: i.createdAt,
              payee: i.payeeName ?? 'New payee',
              amount: num(i.amount),
              kind: dayKind(i.status, i.approved),
              sub: attempt?.txHash ? `${statusChip(i.status).label} · ${attempt.txHash.slice(0, 8)}…` : statusChip(i.status).label,
              href: link(i.id),
            }))}
          />
        </section>

        <section className="card" aria-label="Decisions">
          <div className="card-h">
            <h3>{pendingOnly ? 'Needs your signature' : 'Decisions'}</h3>
            {pendingOnly ? <Link href="/app">Show all</Link> : <span>{rows.length} latest</span>}
          </div>
          <ul className="rows">
            {rows.length === 0 && <li className="empty">{pendingOnly ? 'Nothing is waiting for you.' : 'No payment requests yet.'}</li>}
            {rows.map(({ intent: i, attempt }) => {
              const chip = statusChip(i.status);
              const name = i.payeeName ?? 'New payee';
              return (
                <li key={i.id} className={`row${selected?.intent.id === i.id ? ' sel' : ''}`}>
                  <span className="monogram">{name.replace(/^"/, '').slice(0, 1).toUpperCase()}</span>
                  <span style={{ minWidth: 0 }}>
                    <Link className="t" href={link(i.id)} aria-current={selected?.intent.id === i.id ? 'true' : undefined}>
                      {name}
                    </Link>
                    <span className="m">
                      {timeIst(i.createdAt)} · {reasonLine(i)}
                      {attempt?.txHash && (
                        <>
                          {' · '}
                          <a href={explorerTx(attempt.txHash)} target="_blank" rel="noreferrer">
                            Arc tx
                          </a>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="a">{num(i.amount)}</span>
                  <span className={`st ${chip.cls}`}>{chip.label}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card" aria-label="Daily auto cap">
          <div className="card-h">
            <h3>Daily auto cap</h3>
            <Link className="circle-btn" href="/app/mandate" aria-label="Open the mandate">
              ↗
            </Link>
          </div>
          {mandate ? (
            <>
              <Gauge used={Number(spent)} cap={Number(mandate.limits.daily)} />
              <div className="limits">
                <div>
                  <small>Per payment</small>
                  <b>{Number(mandate.limits.per_tx).toFixed(2)}</b>
                </div>
                <div>
                  <small>Hard max</small>
                  <b>{Number(mandate.limits.hard_max_per_tx).toFixed(2)}</b>
                </div>
              </div>
              <p className="card-sub" style={{ marginTop: 12 }}>
                Mandate v{mandate.version} · {mandate.payees.length} pinned payees · approved payments don&apos;t count toward the cap
              </p>
            </>
          ) : (
            <p className="card-sub">No active mandate.</p>
          )}
        </section>
      </div>
    </>
  );
}
