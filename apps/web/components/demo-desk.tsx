'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DemoItem, DemoState } from '@/lib/public-demo';
import { explorerAddress as addrAt, explorerTx as txAt, TESTNET_EXPLORER } from '@/lib/explorer';
import { HoldButton } from './hold-button';
import { Inbox, laneOf } from './inbox';

// The public demo always runs on testnet, whatever network the owner's treasury is on.
const explorerTx = (h: string) => txAt(h, TESTNET_EXPLORER);
const explorerAddress = (a: string) => addrAt(a, TESTNET_EXPLORER);

const DONE = new Set(['PAID', 'BLOCKED', 'VOIDED', 'REJECTED', 'EXPIRED', 'FAILED', 'CANCELLED', 'NEEDS_HUMAN']);

const short = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const six = (a: string) => Number(a).toFixed(6);
const two = (a: string) => Number(a).toFixed(2);
const groups = (seal: string) => seal.replace(/^sha256:/, '').slice(0, 12).replace(/(.{4})(?=.)/g, '$1 ');
const initial = (name: string | null) => (name ?? '?').replace(/^"/, '').slice(0, 1).toUpperCase();

async function call(path: string, body?: unknown) {
  const res = await fetch(`/api/public-demo/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json;
}

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const CHIP: Record<string, [string, string]> = {
  PAID: ['paid', 'Paid on Arc'],
  QUEUED: ['run', 'Sending'],
  SUBMITTED: ['run', 'Sending'],
  AWAITING_APPROVAL: ['wait', 'Needs you'],
  BLOCKED: ['block', 'Blocked'],
  VOIDED: ['void', 'Void'],
  REJECTED: ['block', 'Refused'],
  EXPIRED: ['void', 'Expired'],
  FAILED: ['block', 'Failed'],
};
const Chip = ({ status }: { status: string }) => {
  const [cls, label] = CHIP[status] ?? ['', status];
  return <span className={`st ${cls}`}>{label}</span>;
};

/** The public demo: run the agent, watch two bills decide themselves, countersign the third. */
export function DemoDesk({ initial: first }: { initial: DemoState }) {
  const [s, setS] = useState(first);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const refresh = useCallback(async () => {
    try {
      setS((await call('state')) as unknown as DemoState);
    } catch {
      /* the next poll will try again */
    }
  }, []);

  const live = s.items.some((i) => !DONE.has(i.status));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [live, refresh]);

  async function run() {
    setBusy(true);
    setErr('');
    try {
      await call('run', {});
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  const m = s.mandate;
  if (!s.enabled || !m) {
    return (
      <p className="dm-off">
        The live demo is switched off right now. The <a href="/#live">receipts</a> on the home page show real decisions on Arc Testnet.
      </p>
    );
  }

  const auto = s.items.find((i) => i.step === 'auto');
  const sign = s.items.find((i) => i.step === 'countersign');
  const finished = s.items.length > 0 && !live;

  return (
    <>
      <section className="dm-head">
        <div>
          <span className="pill">
            <span className="live-dot" /> Real Circle wallet · Arc Testnet
          </span>
          <h1 style={{ marginTop: 20 }}>Countersign a real payment on Arc Testnet.</h1>
          <p className="lede">
            Behind this page is a Circle wallet with test USDC and a mandate that lets an agent pay cents on its own. Run the agent: it sends three
            bills. Two decide themselves. The third waits for your signature.
          </p>
          <div className="dm-run">
            <button type="button" className="btn btn-ink" onClick={run} disabled={busy || live || s.runsLeftToday === 0}>
              {busy ? 'Sending the bills…' : s.items.length ? 'Run the agent again' : 'Run the agent'}
            </button>
            <span className="pill">{s.runsLeftToday > 0 ? `${s.runsLeftToday} runs left today` : 'Today’s budget is spent; it resets at 00:00 UTC'}</span>
          </div>
          {err && (
            <p className="dm-err" role="alert">
              {err}
            </p>
          )}
        </div>
        <aside className="card mandate-card" aria-label="The demo mandate">
          <div className="card-h">
            <h3>The mandate</h3>
            <span>v{m.version}, signed by the owner</span>
          </div>
          <dl>
            <div>
              <dt>Pays on its own, per payment</dt>
              <dd>up to {two(m.perTx)} USDC</dd>
            </div>
            <div>
              <dt>Pays on its own, per day</dt>
              <dd>up to {two(m.daily)} USDC</dd>
            </div>
            <div>
              <dt>Pinned payees</dt>
              <dd>
                {m.payees.map((p) => (
                  <span key={p.address}>
                    {p.name} <code>{short(p.address)}</code>
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt>Treasury</dt>
              <dd>
                <a href={explorerAddress(m.treasury)} target="_blank" rel="noreferrer">
                  <code>{short(m.treasury)}</code>
                </a>
                {s.balance && <span>{Number(s.balance).toFixed(2)} USDC</span>}
              </dd>
            </div>
          </dl>
        </aside>
      </section>

      {s.items.length === 0 ? (
        <section className="dm-steps" aria-label="What will happen">
          <div className="card">
            <span className="st paid">Paid</span>
            <b>A bill inside the mandate</b>
            <p>Oceanic Freight is pinned and 0.02 is under the cap, so Twokey pays it through the Circle wallet without asking.</p>
          </div>
          <div className="card">
            <span className="st block">Blocked</span>
            <b>A known name at a new address</b>
            <p>The classic invoice-redirect scam. Refused before Circle is called, and no approval can override it.</p>
          </div>
          <div className="card ink">
            <span className="st wait">Needs you</span>
            <b>A new payee, over the cap</b>
            <p style={{ color: 'var(--faint)' }}>Sealed to its exact terms and held for your signature. Sign it, or let the agent change a cent first.</p>
          </div>
        </section>
      ) : (
        <section className="dm-desk" aria-label="The agent's three bills" aria-live="polite">
          <Inbox
            per={3}
            items={s.items.map((i) => ({
              id: i.id,
              payee: i.payee ?? short(i.address),
              amount: two(i.amount),
              lane: laneOf(i.status),
              note: noteFor(i, two(m.perTx)),
              meta: <TxLine item={i} />,
            }))}
          />
          {sign && <SignCard item={sign} cap={two(m.perTx)} onChange={refresh} />}
        </section>
      )}

      {finished && (
        <p className="dm-done">
          That was the whole loop: two decisions made by the mandate, one by you, each written to a hash-chained audit log
          {[auto, sign].some((i) => i?.txHash) ? ', with the Arc transactions linked above' : ''}. Run it again, or try the other ending this time.
        </p>
      )}
    </>
  );
}

function TxLine({ item }: { item: DemoItem }) {
  if (item.txHash) {
    return (
      <a href={explorerTx(item.txHash)} target="_blank" rel="noreferrer">
        {short(item.txHash)}
        {item.seconds !== null ? ` · ${item.seconds.toFixed(1)} s` : ''}
      </a>
    );
  }
  if (item.status === 'QUEUED' || item.status === 'SUBMITTED') return <span>Sending through the Circle wallet…</span>;
  if (item.status === 'AWAITING_APPROVAL') return <span>Waiting for you</span>;
  if (item.status === 'FAILED' || item.status === 'NEEDS_HUMAN') return <span>Circle did not confirm; not retried</span>;
  return <span>No Circle call was made</span>;
}

/** One line on why a bill is in its lane. */
function noteFor(i: DemoItem, cap: string): string {
  if (i.step === 'auto') return i.status === 'PAID' ? `Pinned payee, under the ${cap} cap. Paid without asking.` : `Pinned payee, under the ${cap} cap. Sending.`;
  if (i.step === 'impostor') return 'Same name as a pinned payee, new address: an invoice-redirect scam. Refused before Circle.';
  switch (i.status) {
    case 'AWAITING_APPROVAL':
      return `New payee, over the ${cap} cap. Sealed, waiting for your signature.`;
    case 'PAID':
      return 'Signed by you. The seal still matched when it was sent.';
    case 'VOIDED':
      return 'Changed after it was sealed. Your signature does not cover it.';
    case 'REJECTED':
      return 'Refused by you. Nothing was sent.';
    case 'EXPIRED':
      return 'Nobody signed in time. Nothing was sent.';
    default:
      return 'Signed by you. Checking the seal once more, then sending.';
  }
}

function headline(i: DemoItem) {
  switch (i.status) {
    case 'AWAITING_APPROVAL':
      return 'Needs your signature';
    case 'QUEUED':
    case 'SUBMITTED':
      return 'Signed, sending on Arc';
    case 'PAID':
      return 'Paid with your signature';
    case 'VOIDED':
      return 'Void: the terms changed';
    case 'REJECTED':
      return 'Refused by you';
    case 'EXPIRED':
      return 'Expired unsigned';
    default:
      return 'Outside the mandate';
  }
}

/** The one the visitor signs. Everything it shows comes from the server; the hold only sends the seal. */
function SignCard({ item, cap, onChange }: { item: DemoItem; cap: string; onChange: () => Promise<void> }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState<boolean | null>(null);
  const a = item.approval;
  const pending = item.status === 'AWAITING_APPROVAL' && a?.status === 'PENDING';
  const inGrace = item.status === 'QUEUED' && a?.status === 'APPROVED';
  const sealedAmount = a ? (JSON.parse(a.canonical) as { amount: string }).amount : item.amount;
  const drifted = Number(sealedAmount) !== Number(item.amount);

  // The browser recomputes the seal from the canonical terms, so nobody has to take the server's word for it.
  useEffect(() => {
    if (!a) return;
    let on = true;
    void sha256Hex(a.canonical).then((h) => on && setMatch(`sha256:${h}` === a.seal));
    return () => {
      on = false;
    };
  }, [a]);

  async function act(path: string, body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const r = (await call(path, { paymentId: item.id, ...body })) as { note?: string; from?: string; to?: string };
      setStatus(r.from ? `The agent changed the amount from ${six(r.from)} to ${six(r.to!)}.` : r.note ? `${ok} ${r.note}` : ok);
    } catch (e) {
      setStatus((e as Error).message.replace(/^./, (c) => c.toUpperCase()) + '.');
    }
    await onChange();
    setBusy(false);
  }

  const v = item.voidDetail;
  return (
    <section className={`focus${item.status === 'VOIDED' ? ' is-void' : ''}`} aria-label="The bill that needs your signature">
      <div className="f-top">
        <b>{headline(item)}</b>
        {pending && a ? <span>expires {new Date(a.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : <Chip status={item.status} />}
      </div>
      <p className="bill-note">
        {pending
          ? `A new payee, and over the ${cap} cap. Twokey sealed the exact terms. Hold to sign them, or let the agent change a cent first and see what happens.`
          : item.status === 'PAID'
            ? 'Your signature covered these exact terms, and they still matched when Twokey sent the payment through the Circle wallet.'
            : item.status === 'VOIDED'
              ? 'The payment no longer matched the terms you were shown, so your signature does not cover it. No Circle call was made.'
              : inGrace
                ? 'Twokey pauses a few seconds, rebuilds the terms from the payment as it will be sent, checks your seal against them, then calls Circle.'
                : ''}
      </p>
      <div className="f-who">
        <span className="monogram">{initial(item.payee)}</span>
        <div>
          <b>{item.payee ?? 'New payee'}</b>
          <small>
            new payee · {short(item.address)} · {item.memo}
          </small>
        </div>
      </div>
      <div className="f-amt">
        {two(item.amount)}
        <em>USDC</em>
      </div>
      <ul className="f-why">
        {item.failed.map((f) => (
          <li key={f.id} className="ask">
            {f.detail}
          </li>
        ))}
      </ul>
      {a && (
        <div className="f-seal">
          <span>{match === true ? 'Sealed · your browser recomputed it: matches' : match === false ? 'Sealed · does not match the terms' : 'Sealed to these exact terms'}</span>
          <b>{groups(a.seal)}</b>
        </div>
      )}

      {pending && drifted && (
        <div className="f-note void">
          The agent changed the amount to {six(item.amount)} after Twokey sealed {six(sealedAmount)}. Sign anyway and see.
        </div>
      )}
      {item.status === 'VOIDED' && (
        <div className="f-note void">
          {v?.amount_from
            ? `The amount changed from ${six(v.amount_from)} to ${six(v.amount_to!)} after it was sealed. The seal no longer matches, so nothing was sent.`
            : 'The terms changed after they were sealed, so nothing was sent.'}
        </div>
      )}
      {item.status === 'PAID' && (
        <div className="f-note paid">
          {item.txHash ? (
            <a href={explorerTx(item.txHash)} target="_blank" rel="noreferrer">
              Final on Arc · tx {short(item.txHash)}
            </a>
          ) : (
            'Final on Arc'
          )}
          {item.seconds !== null && ` · ${item.seconds.toFixed(1)} s after your signature, counting the pause before sending`}
        </div>
      )}
      {(item.status === 'REJECTED' || item.status === 'EXPIRED') && <div className="f-note block">Nothing was sent.</div>}

      {pending && (
        <HoldButton
          key={`hold-${a?.id}`}
          disabled={busy}
          onStart={() => setStatus('Keep holding: you are signing the sealed terms.')}
          onEarly={() => setStatus('Let go too early. Hold until the knob reaches the end.')}
          onDone={() => void act('countersign', { seal: a!.seal }, 'Signed. Twokey checks the seal once more, then sends.')}
        />
      )}
      {inGrace && <div className="f-note">Signed. Sending in a few seconds…</div>}
      {(pending || inGrace) && (
        <div className="f-acts">
          <button type="button" disabled={busy} onClick={() => void act('drift', {}, '')}>
            Let the agent change a cent
          </button>
          {pending && (
            <button type="button" disabled={busy} onClick={() => void act('refuse', {}, 'Refused. Nothing was sent.')}>
              Refuse
            </button>
          )}
        </div>
      )}
      <p className="f-status" role="status" aria-live="polite">
        {!DONE.has(item.status) && status}
      </p>
      {a && (
        <details className="f-terms">
          <summary>What you are signing</summary>
          <pre>{JSON.stringify(JSON.parse(a.canonical), null, 2)}</pre>
          <p>
            The seal is SHA-256 over these terms in one canonical form (RFC 8785): <code>{a.seal}</code>
          </p>
        </details>
      )}
    </section>
  );
}
