'use client';

import { useEffect, useRef, useState } from 'react';
import { HoldButton } from './hold-button';

type Phase = 'idle' | 'signed' | 'paid' | 'void';

/** Sorted-key JSON of a flat object: the same canonical idea Twokey seals with (RFC 8785), small enough for a browser. */
const canonical = (o: Record<string, string>) => `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(o[k])}`).join(',')}}`;

async function seal(terms: Record<string, string>): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(terms)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const groups = (hex: string) => (hex ? `${hex.slice(0, 4)} ${hex.slice(4, 8)} ${hex.slice(8, 12)}` : '···· ···· ····');

/**
 * The hero: a payment the agent asked for that needs your signature. The seal is a real SHA-256 of the
 * terms shown; let the agent change a cent and it no longer matches what you signed.
 */
export function SignatureCard({ paidTx, paidSeconds }: { paidTx: string | null; paidSeconds: number | null }) {
  const [amount, setAmount] = useState('0.75');
  const [phase, setPhase] = useState<Phase>('idle');
  const [sealHex, setSealHex] = useState('');
  const [signedSeal, setSignedSeal] = useState('');
  const [status, setStatus] = useState('');
  const doneAt = useRef(0);

  const terms = { payee: 'Brightline Media', address: '0x8569462fa82f8e9ecbfaf6227bbf383d2c8a9b92', amount: `${amount}0000`, token: 'USDC', network: 'ARC-TESTNET', memo: 'BM-7' };

  useEffect(() => {
    let live = true;
    void seal(terms).then((h) => live && setSealHex(h));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  const signed = () => {
    doneAt.current = performance.now();
    setSignedSeal(sealHex);
    setPhase('signed');
    setStatus('Signed. Twokey checks the seal once more, then sends.');
    window.setTimeout(() => {
      setPhase((ph) => (ph === 'signed' ? 'paid' : ph));
      setStatus('');
    }, 1100);
  };
  const drift = () => {
    setAmount('0.76');
    if (phase === 'signed' || phase === 'paid') {
      setPhase('void');
      setStatus('');
    } else {
      setStatus('The agent changed the amount, and the seal changed with it: you would be signing new terms.');
    }
  };
  const reset = () => {
    // The finger that finished the signature may still be down; its release is not "Start over".
    if (performance.now() - doneAt.current < 600) return;
    setAmount('0.75');
    setPhase('idle');
    setSignedSeal('');
    setStatus('');
  };

  return (
    <section className={`focus${phase === 'void' ? ' is-void' : ''}`} aria-label="Try a countersignature">
      <div className="f-top">
        <b>{phase === 'paid' ? 'Paid with your signature' : phase === 'void' ? 'Void: the terms changed' : 'Needs your signature'}</b>
        {phase === 'paid' ? (
          <span className="st paid">Paid on Arc{paidSeconds ? ` · ${paidSeconds.toFixed(1)} s` : ''}</span>
        ) : phase === 'void' ? (
          <span className="st block">Void · nothing sent</span>
        ) : (
          <span>expires in 15 min</span>
        )}
      </div>
      <div className="f-who">
        <span className="monogram">B</span>
        <div>
          <b>Brightline Media</b>
          <small>new payee · 0x8569…9b92 · memo BM-7</small>
        </div>
      </div>
      <div className="f-amt" aria-live="polite">
        {amount}
        <em>USDC</em>
      </div>
      <ul className="f-why">
        <li className="ask">Not in your mandate</li>
        <li className="ask">Over your 0.50 per-payment cap</li>
      </ul>
      <div className="f-seal">
        <span>Sealed to these exact terms</span>
        <span>
          <b>{groups(sealHex)}</b>
          {signedSeal && signedSeal !== sealHex && <s> {groups(signedSeal)}</s>}
        </span>
      </div>

      {phase === 'idle' ? (
        <HoldButton
          key="hold"
          onStart={() => setStatus('Keep holding: you are signing these exact terms.')}
          onEarly={() => setStatus('Let go too early. Hold until the knob reaches the end.')}
          onDone={signed}
        />
      ) : phase === 'void' ? (
        <div className="f-note void">You signed {groups(signedSeal)}. The agent then asked for 0.76, which hashes to {groups(sealHex)}. The seals differ, so nothing is sent.</div>
      ) : (
        <div className="f-note paid">
          {phase === 'signed' ? 'Sending through the Circle wallet…' : 'Final on Arc.'}{' '}
          {phase === 'paid' && paidTx && (
            <a href={`https://explorer.testnet.arc.io/tx/${paidTx}`} target="_blank" rel="noreferrer">
              See a real one
            </a>
          )}
        </div>
      )}
      <div className="f-acts">
        <button type="button" onClick={drift} disabled={amount !== '0.75'}>
          Let the agent change a cent
        </button>
        {phase !== 'idle' && (
          <button key="reset" type="button" onClick={reset}>
            Start over
          </button>
        )}
      </div>
      <p className="f-status" role="status" aria-live="polite">
        {status || (phase === 'idle' ? 'An illustration. The live demo signs real payments on Arc Testnet.' : '')}
      </p>
    </section>
  );
}
