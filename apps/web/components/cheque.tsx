'use client';

import { useEffect, useRef, useState } from 'react';
import { useHold } from './use-hold';

type Phase = 'idle' | 'signed' | 'paid' | 'void';

const HOLD_MS = 1400;
const SIG_LEN = 560;

/** Sorted-key JSON of a flat object: the same canonical idea Twokey seals with (RFC 8785), small enough for a browser. */
const canonical = (o: Record<string, string>) => `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(o[k])}`).join(',')}}`;

async function seal(terms: Record<string, string>): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(terms)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const groups = (hex: string) => (hex ? `${hex.slice(0, 4)} ${hex.slice(4, 8)} ${hex.slice(8, 12)}` : '···· ···· ····');

/**
 * The hero: a cheque the agent has written. Hold to countersign it; the seal is a real SHA-256 of the
 * terms shown. Let the agent change a cent and the seal no longer matches what you signed.
 */
export function Cheque({ paidTx, paidSeconds, rosette }: { paidTx: string | null; paidSeconds: number | null; rosette: React.ReactNode }) {
  const [amount, setAmount] = useState('0.750000');
  const [phase, setPhase] = useState<Phase>('idle');
  const [sealHex, setSealHex] = useState('');
  const [signedSeal, setSignedSeal] = useState('');
  const [status, setStatus] = useState('');
  const sigRef = useRef<SVGPathElement>(null);

  const terms = { payee: 'Brightline Media', address: '0x8569462fa82f8e9ecbfaf6227bbf383d2c8a9b92', amount, token: 'USDC', network: 'ARC-TESTNET', memo: 'BM-7', expires: '2026-10-27T16:36:00Z' };

  useEffect(() => {
    let live = true;
    void seal(terms).then((h) => live && setSealHex(h));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  const draw = (p: number) => sigRef.current?.style.setProperty('stroke-dashoffset', String(SIG_LEN * (1 - p)));

  const hold = useHold({
    ms: HOLD_MS,
    onProgress: draw,
    onDone: () => {
      setSignedSeal(sealHex);
      setPhase('signed');
      setStatus('Countersigned. Sending on Arc…');
      window.setTimeout(() => {
        setPhase((ph) => (ph === 'signed' ? 'paid' : ph));
        setStatus('Paid on Arc.');
      }, 1100);
    },
  });

  const start = () => {
    if (phase !== 'idle') return;
    hold.start();
    setStatus('Keep holding: you are signing these exact terms.');
  };
  const end = () => {
    if (hold.end()) setStatus('Let go too early. Hold until the signature is complete.');
  };

  const drift = () => {
    setAmount('0.760000');
    if (phase === 'signed' || phase === 'paid' || hold.progress() > 0) {
      setPhase('void');
      setStatus('The agent changed the amount after you signed. The seal no longer matches, so nothing is sent.');
    } else {
      setStatus('The agent changed the amount. The seal changed with it: you would be signing new terms.');
    }
  };
  const reset = () => {
    // The finger that finished the signature is often still down; its release must not count as "Start over".
    if (hold.justDone()) return;
    hold.reset();
    setAmount('0.750000');
    setPhase('idle');
    setSignedSeal('');
    setStatus('');
  };

  return (
    <div className="cq-wrap">
      <div className={`cheque${phase === 'void' ? ' is-void' : ''}`}>
        <div className="rosette">{rosette}</div>
        <div className="cq-top">
          <span>
            <b>Treasury</b> Circle wallet on Arc Testnet
          </span>
          <span>No. BM-7 · 27 Oct 2026</span>
        </div>
        <div className="cq-payto">
          <span className="cq-k">Pay to the order of</span>
          <span className="cq-v">Brightline Media</span>
          <span className="cq-amt" aria-live="polite">
            USDC {amount}
          </span>
        </div>
        <div className="cq-words">{amount === '0.750000' ? 'Seventy-five cents' : 'Seventy-six cents'} in USDC, for campaign creative</div>
        <div className="cq-why">
          <span>New payee, not in your mandate</span>
          <span>Over your 0.50 per-payment cap</span>
          <span className="cq-seal">
            Sealed {groups(sealHex)}
            {signedSeal && signedSeal !== sealHex && <s> {groups(signedSeal)}</s>}
          </span>
        </div>
        <div className="cq-sigs">
          <div className="cq-sig">
            <span className="cq-hand">ap-agent</span>
            <span className="cq-line">Requested by your agent</span>
          </div>
          <div className="cq-sig">
            <svg viewBox="0 0 320 64" aria-hidden="true">
              <path
                ref={sigRef}
                d="M10 44 C 30 8, 46 58, 66 28 S 100 10, 110 38 S 142 54, 160 20 C 168 8, 180 50, 198 34 S 236 14, 252 40 C 262 56, 280 22, 306 30"
                fill="none"
                stroke="#24427a"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeDasharray={SIG_LEN}
                strokeDashoffset={SIG_LEN}
              />
            </svg>
            <span className="cq-line">Your countersignature</span>
          </div>
        </div>
        <div className="cq-micr" aria-hidden="true">
          ⑆ 5042002 ⑆ 0x8569…9b92 ⑈ 0x3600…0000 ⑉
        </div>
        {phase === 'paid' && (
          <div className="stamp paid-stamp">
            Paid on Arc
            <small>{paidSeconds ? `${paidSeconds.toFixed(1)} s` : 'final'}</small>
          </div>
        )}
        {phase === 'void' && <div className="stamp void-stamp">Void</div>}
      </div>

      <div className="cq-actions">
        {phase === 'idle' ? (
          <button
            key="hold"
            type="button"
            className="cq-hold"
            onPointerDown={(e) => {
              e.preventDefault();
              start();
            }}
            onPointerUp={end}
            onPointerLeave={end}
            onPointerCancel={end}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
                e.preventDefault();
                start();
              }
            }}
            onKeyUp={end}
          >
            Hold to countersign
          </button>
        ) : (
          <button key="reset" type="button" className="cq-ghost" onClick={reset}>
            Start over
          </button>
        )}
        <button type="button" className="cq-ghost" onClick={drift} disabled={amount !== '0.750000'}>
          Let the agent change a cent
        </button>
      </div>
      <p className="cq-status" role="status" aria-live="polite">
        {status ||
          'Press and hold to sign. This one is an illustration; the live demo signs real Arc Testnet payments.'}
        {phase === 'paid' && paidTx && (
          <>
            {' '}
            <a href={`https://explorer.testnet.arc.io/tx/${paidTx}`} target="_blank" rel="noreferrer">
              See a real one on Arc
            </a>
          </>
        )}
      </p>
    </div>
  );
}
