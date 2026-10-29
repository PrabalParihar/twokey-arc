import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSession } from '@twokey-arc/core';
import { SignupForm } from '@/components/setup';
import { SESSION_COOKIE } from '@/lib/http';
import { db, SANDBOX_ENABLED } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Start a free sandbox · Twokey',
  description: 'A Circle wallet on Arc Testnet, a mandate you sign, and an agent key: set up in about five minutes, no card.',
};

export default async function SignupPage() {
  if (await getSession(db(), (await cookies()).get(SESSION_COOKIE)?.value)) redirect('/app');
  return (
    <main className="su">
      <div className="su-l">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true" /> Twokey
        </Link>
        <h1>Give your agent a wallet it can&apos;t run off with.</h1>
        <p className="sub">A free sandbox on Arc Testnet. No card, no real money.</p>
        {SANDBOX_ENABLED ? (
          <SignupForm />
        ) : (
          <p className="su-closed">Sign-ups are closed on this deployment. Try the live demo instead.</p>
        )}
        <p className="su-alt">
          Have an account? <Link href="/login">Sign in</Link> · or <Link href="/demo">countersign a live payment</Link> first
        </p>
      </div>
      <div className="su-r">
        <small>In the next five minutes</small>
        <div className="su-get">
          <i>1</i>
          <div>
            <b>A Circle wallet on Arc Testnet</b>Funded with test USDC from Circle&apos;s faucet.
          </div>
        </div>
        <div className="su-get">
          <i>2</i>
          <div>
            <b>Your mandate, signed by you</b>What your agent may pay alone, and to whom.
          </div>
        </div>
        <div className="su-get">
          <i>3</i>
          <div>
            <b>Approvals on your phone</b>Anything outside the mandate waits for your hold, here or on Telegram.
          </div>
        </div>
        <div className="su-get">
          <i>4</i>
          <div>
            <b>An agent key on a badge</b>One HTTP call, the SDK or MCP, and your agent is paying.
          </div>
        </div>
      </div>
    </main>
  );
}
