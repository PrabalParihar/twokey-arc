import type { Metadata } from 'next';
import Link from 'next/link';
import '../landing.css';
import { DemoDesk } from '@/components/demo-desk';
import { Guilloche } from '@/components/guilloche';
import { paperFonts } from '@/lib/fonts';
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
    <div className={`lp ${paperFonts}`}>
      <Guilloche className="bg" viewBox="0 0 1440 1100" cx={1320} cy={1020} R={430} r={89} d={150} layers={4} color="#b9cbbf" width={0.6} />
      <div className="wrap">
        <nav className="lp-nav" aria-label="Main">
          <Link href="/" className="lp-brand">
            Twokey <span>on Arc</span>
          </Link>
          <div className="lp-links">
            <Link href="/#seal">How the seal works</Link>
            <Link href="/#live">Receipt tape</Link>
            <Link href="/#developers">Developers</Link>
          </div>
          <div className="lp-cta">
            <Link className="lp-btn plain" href="/app">
              Console
            </Link>
          </div>
        </nav>

        <DemoDesk initial={initial} />

        <footer className="lp-foot">
          <span>Arc Testnet: test USDC, no real money moves. Runs are rate limited and capped per day.</span>
          <span>
            <Link href="/">Back to Twokey</Link>
          </span>
        </footer>
      </div>
    </div>
  );
}
