import { getActiveMandate, latestBalance } from '@twokey-arc/core';
import { CopyButton, IssueAgentKey } from '@/components/client';
import { dateTimeIst, displayUsdc, networkName, sealGroups, shortAddr } from '@/lib/format';
import { explorerAddress } from '@/lib/explorer';
import { db } from '@/lib/server';
import { pageOwner } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MandatePage() {
  const { csrf, cfg } = await pageOwner();
  const m = await getActiveMandate(db(), cfg.orgId);
  if (!m) {
    return (
      <div className="head">
        <div>
          <h1>Mandate</h1>
          <p>No active mandate. Run pnpm seed.</p>
        </div>
      </div>
    );
  }
  const bal = await latestBalance(db(), m.source_wallet.circle_wallet_id);
  return (
    <>
      <div className="head">
        <div>
          <h1>Mandate v{m.version}</h1>
          <p>
            Signed by {m.signed_by} · {dateTimeIst(m.signed_at)} · sealed <span className="mono">{sealGroups(m.signature)}</span>
          </p>
        </div>
        <span className="st paid">Active until {dateTimeIst(m.expires_at)}</span>
      </div>
      <div className="page">
        <div className="grid2">
          <div className="panel lime">
            <h3>Runs on its own up to</h3>
            <div className="big">{displayUsdc(m.limits.per_tx)}</div>
            <p>per payment, to a pinned payee</p>
          </div>
          <div className="panel">
            <h3>Daily auto total</h3>
            <div className="big">{displayUsdc(m.limits.daily)}</div>
            <p>resets 00:00 {m.timezone === 'Asia/Kolkata' ? 'IST' : m.timezone}; approved payments don&apos;t count</p>
          </div>
          <div className="panel">
            <h3>Hard maximum</h3>
            <div className="big">{displayUsdc(m.limits.hard_max_per_tx)}</div>
            <p>above this, blocked; no approval can override</p>
          </div>
          <div className="panel ink">
            <h3>Treasury (Circle wallet on Arc)</h3>
            <div className="big">{bal ? displayUsdc(bal.usdc) : '—'}</div>
            <p>
              <a href={explorerAddress(m.source_wallet.address, cfg.explorerUrl)} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--lime)' }}>
                {shortAddr(m.source_wallet.address)} ↗
              </a>{' '}
              · keeps {displayUsdc(m.limits.min_balance_after)} for gas (USDC)
            </p>
          </div>
        </div>

        <section className="card">
          <div className="card-h">
            <h3>Pinned payees</h3>
            <span>each payee can only be paid at its own address</span>
          </div>
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Payee</th>
                <th>Address (pinned)</th>
                <th>Network</th>
                <th>Per-payment cap</th>
              </tr>
            </thead>
            <tbody>
              {m.payees.map((p) => (
                <tr key={p.payee_id}>
                  <td>
                    {p.name}
                    <div className="mono">{p.payee_id}</div>
                  </td>
                  <td>
                    <span className="mono" title={p.address}>
                      {shortAddr(p.address)}
                    </span>{' '}
                    <CopyButton text={p.address} />
                    <div className="mono">fingerprint {sealGroups(p.fingerprint)}</div>
                  </td>
                  <td>{networkName(p.network)}</td>
                  <td>{p.per_tx_override ? displayUsdc(p.per_tx_override) : displayUsdc(m.limits.per_tx)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ margin: '12px 0 0' }}>
            A known payee at any other address is blocked (INV-PAYEE-PINNED). Tightening a limit applies at once; loosening one, adding a payee or changing an
            address needs an approval. Approvals wait {m.approval.ttl_minutes} min
            {m.approval.telegram ? ' and are also sent to Telegram' : ''}.
          </p>
        </section>
        <IssueAgentKey csrf={csrf} />
      </div>
    </>
  );
}
