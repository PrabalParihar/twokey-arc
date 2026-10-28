import type { Metadata } from 'next';
import Link from 'next/link';
import '../landing.css';
import { DemoDesk } from '@/components/demo-desk';
import { demoState, type DemoState } from '@/lib/public-demo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Live demo: countersign a payment on Arc Testnet · Twokey',
  description:
    'Run an AI agent against a real Circle wallet on Arc Testnet. Watch one bill pay itself, one get refused, and countersign the third. No sign-up.',
};

async function load(): Promise<DemoState> {
  try {
    return await demoState();
  } catch {
    return { enabled: false, run: null, items: [], mandate: null, balance: null, runsLeftToday: 0 };
  }
}

export default async function DemoPage() {
  const initial = await load();
  return (
    <div className="lp">
      <div className="wrap">
        <nav className="lp-nav" aria-label="Main">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true" /> Twokey
          </Link>
          <div className="lp-links">
            <Link href="/#seal">
              How the seal works
            </Link>
            <Link href="/#live">
              Live receipts
            </Link>
            <Link href="/#developers">
              Developers
            </Link>
          </div>
          <div className="lp-cta">
            <Link className="btn btn-sm" href="/app">
              Console
            </Link>
          </div>
        </nav>

        <DemoDesk initial={initial} />

        <footer className="lp-foot" style={{ paddingBottom: 40 }}>
          <div className="foot-row">
            <span>Arc Testnet: test USDC, no real money moves. Runs are rate limited and capped per day.</span>
            <Link href="/">Back to Twokey</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
