import Link from 'next/link';
import { and, count, eq } from 'drizzle-orm';
import { approvals } from '@twokey-arc/db';
import { getActiveMandate, latestBalance } from '@twokey-arc/core';
import { SignOut } from '@/components/client';
import { NavLinks } from '@/components/nav';
import { displayUsdc, shortAddr } from '@/lib/format';
import { cfg, db } from '@/lib/server';
import { pageOwner } from '@/lib/session';

export const dynamic = 'force-dynamic';

function Mark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="12" r="4.5" stroke="#18304f" strokeWidth="1.8" />
      <circle cx="16" cy="12" r="4.5" stroke="#2c6a4a" strokeWidth="1.8" />
    </svg>
  );
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user, csrf } = await pageOwner();
  const [pending] = await db().select({ n: count() }).from(approvals).where(and(eq(approvals.orgId, cfg.orgId), eq(approvals.status, 'PENDING')));
  const mandate = await getActiveMandate(db(), cfg.orgId);
  const bal = mandate ? await latestBalance(db(), mandate.source_wallet.circle_wallet_id) : null;
  return (
    <div className="app">
      <header className="bar">
        <Link href="/app" className="brand">
          <Mark /> Twokey
        </Link>
        <div className="crumb">
          Treasury<em>/</em>Arc Testnet
          {process.env.TWOKEY_PREVIEW === 'simulated' && (
            <span className="st void" style={{ marginLeft: 12 }}>
              Local preview · simulated Circle, no Arc transactions
            </span>
          )}
        </div>
        <div className="bar-right">
          <span className="net">
            <i /> Arc Testnet · {cfg.chainId}
          </span>
          <SignOut csrf={csrf} />
          <span className="av" title={user.displayName}>
            {user.displayName.slice(0, 1).toUpperCase()}
          </span>
        </div>
      </header>
      <div className="body">
        <nav className="side" aria-label="Sections">
          <NavLinks pending={pending?.n ?? 0} />
          <h4>Treasury</h4>
          <div className="kv">
            <span>Balance</span>
            <b>{bal ? displayUsdc(bal.usdc) : '—'}</b>
          </div>
          <div className="kv">
            <span>Wallet</span>
            <span className="mono">{shortAddr(mandate?.source_wallet.address)}</span>
          </div>
          <div className="kv">
            <span>Gas</span>
            <span>paid in USDC</span>
          </div>
          {mandate && (
            <>
              <h4>Mandate v{mandate.version}</h4>
              <div className="kv">
                <span>Per payment</span>
                <b>{displayUsdc(mandate.limits.per_tx)}</b>
              </div>
              <div className="kv">
                <span>Daily auto</span>
                <b>{displayUsdc(mandate.limits.daily)}</b>
              </div>
            </>
          )}
          <h4>Agents</h4>
          <div className="kv">
            <span>Accounts payable agent</span>
          </div>
          <div className="foot">Circle Wallets · USDC on Arc</div>
        </nav>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
