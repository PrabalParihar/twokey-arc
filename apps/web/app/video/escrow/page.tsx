import type { Metadata } from 'next';
import Link from 'next/link';
import '../../landing.css';

const ESCROW = '0x5D1333bA6E53Cb3A5Ff26Ff22cC1d4E9c8A49715';

export const metadata: Metadata = {
  title: 'Twokey Escrow · built in Arc Studio, live on Arc mainnet',
  description:
    'The two-key rule for AI agent payments as a contract: built and tested in Arc Studio, deployed to Arc mainnet, with real USDC auto-paid within a limit and countersigned above it.',
  openGraph: { images: ['/video/twokey-escrow-poster.jpg'] },
};

export default function EscrowVideoPage() {
  return (
    <div className="lp">
      <div className="wrap">
        <nav className="lp-nav" aria-label="Main">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true" /> Twokey
          </Link>
          <div className="lp-cta">
            <a className="btn btn-ink btn-sm" href="https://fascinating-figolla-b5b7a2.netlify.app">
              Open the escrow app
            </a>
          </div>
        </nav>
        <section className="sec" style={{ paddingTop: 24 }}>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', letterSpacing: '-.03em', margin: '0 0 10px' }}>Twokey Escrow, built in Arc Studio</h1>
          <p className="lede" style={{ marginBottom: 22 }}>
            The build in Arc Studio, then real USDC through the contract on Arc mainnet: 0.05 auto-paid within the limit, 0.20 held until the owner countersigned.
          </p>
          <video
            src="/video/twokey-escrow.mp4"
            poster="/video/twokey-escrow-poster.jpg"
            controls
            playsInline
            preload="metadata"
            style={{ width: '100%', borderRadius: 20, background: '#0f1012', boxShadow: '0 30px 60px -30px rgba(15,16,18,.5)' }}
          />
          <p className="lede" style={{ marginTop: 18, fontSize: 15 }}>
            Contract: <a href={`https://explorer.arc.io/address/${ESCROW}`}>{ESCROW.slice(0, 6)}…{ESCROW.slice(-4)} on explorer.arc.io</a> · Code:{' '}
            <a href="https://github.com/PrabalParihar/twokey-escrow-studio">github.com/PrabalParihar/twokey-escrow-studio</a> · App:{' '}
            <a href="https://fascinating-figolla-b5b7a2.netlify.app">fascinating-figolla-b5b7a2.netlify.app</a>
          </p>
        </section>
      </div>
    </div>
  );
}
