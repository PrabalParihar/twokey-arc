import Link from 'next/link';
import { and, count, eq } from 'drizzle-orm';
import { approvals } from '@twokey-arc/db';
import { getActiveMandate } from '@twokey-arc/core';
import { SignOut } from '@/components/client';
import { NavLinks } from '@/components/nav';
import { networkName, shortAddr } from '@/lib/format';
import { cfg, db } from '@/lib/server';
import { pageOwner } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user, csrf } = await pageOwner();
  const [pending] = await db().select({ n: count() }).from(approvals).where(and(eq(approvals.orgId, cfg.orgId), eq(approvals.status, 'PENDING')));
  const mandate = await getActiveMandate(db(), cfg.orgId);
  return (
    <div className="app">
      <header className="bar">
        <Link href="/app" className="brand">
          <span className="brand-mark" aria-hidden="true" /> Twokey
        </Link>
        <nav className="nav" aria-label="Sections">
          <NavLinks pending={pending?.n ?? 0} />
        </nav>
        <div className="bar-right">
          {process.env.TWOKEY_PREVIEW === 'simulated' && <span className="pill preview-tag">Local preview · simulated Circle</span>}
          <span className="pill">
            <span className="live-dot" /> {networkName(cfg.network)} · {cfg.chainId}
          </span>
          {cfg.network === 'ARC' && <span className="pill lime">Real USDC</span>}
          {mandate && <span className="pill">Circle wallet {shortAddr(mandate.source_wallet.address)}</span>}
          <SignOut csrf={csrf} />
          <span className="av" title={user.displayName}>
            {user.displayName.slice(0, 1).toUpperCase()}
          </span>
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
