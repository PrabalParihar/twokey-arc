import type { Metadata } from 'next';
import Link from 'next/link';
import '../landing.css';

export const metadata: Metadata = {
  title: 'Twokey on Arc · 3-minute walkthrough',
  description: 'A sandbox sign-up on Arc Testnet, a signed mandate, the agent’s badge, a payment inside the mandate and one that waits for a hold, the audit log, and the mainnet treasury.',
  openGraph: { images: ['/video/poster.jpg'] },
};

export default function VideoPage() {
  return (
    <div className="lp">
      <div className="wrap">
        <nav className="lp-nav" aria-label="Main">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true" /> Twokey
          </Link>
          <div className="lp-cta">
            <Link className="btn btn-sm lp-console" href="/signup">
              Start free
            </Link>
            <Link className="btn btn-ink btn-sm" href="/demo">
              Countersign a live payment
            </Link>
          </div>
        </nav>
        <section className="sec" style={{ paddingTop: 24 }}>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', letterSpacing: '-.03em', margin: '0 0 10px' }}>Twokey on Arc, in under three minutes</h1>
          <p className="lede" style={{ marginBottom: 22 }}>
            Recorded on real Arc Testnet transactions through Circle developer-controlled wallets, and the mainnet treasury on the Arc explorer.
          </p>
          <video
            src="/video/twokey-on-arc.mp4"
            poster="/video/poster.jpg"
            controls
            playsInline
            preload="metadata"
            style={{ width: '100%', borderRadius: 20, background: '#0f1012', boxShadow: '0 30px 60px -30px rgba(15,16,18,.5)' }}
          />
          <p className="lede" style={{ marginTop: 18, fontSize: 15 }}>
            Code: <a href="https://github.com/PrabalParihar/twokey-arc">github.com/PrabalParihar/twokey-arc</a> · Sandbox: <Link href="/signup">twokey.si/signup</Link>{' '}
            · Demo: <Link href="/demo">twokey.si/demo</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
