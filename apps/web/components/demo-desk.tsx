'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoItem, DemoState } from '@/lib/public-demo';
import { explorerAddress, explorerTx } from '@/lib/explorer';
import { useHold } from './use-hold';

const HOLD_MS = 1400;
const SIG_LEN = 560;
const DONE = new Set(['PAID', 'BLOCKED', 'VOIDED', 'REJECTED', 'EXPIRED', 'FAILED', 'CANCELLED', 'NEEDS_HUMAN']);

const short = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const six = (a: string) => Number(a).toFixed(6);
const two = (a: string) => Number(a).toFixed(2);
const groups = (seal: string) => seal.replace(/^sha256:/, '').slice(0, 12).replace(/(.{4})(?=.)/g, '$1 ');
const CENTS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const words = (a: string) => {
  const c = Math.round(Number(a) * 100);
  return Math.abs(Number(a) * 100 - c) < 1e-6 && c <= 10 ? `${CENTS[c]} cent${c === 1 ? '' : 's'} in USDC` : `${six(a)} USDC`;
};

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

/** The public demo: run the agent, watch two bills decide themselves, countersign the third. */
export function DemoDesk({ initial }: { initial: DemoState }) {
  const [s, setS] = useState(initial);
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
        The live demo is switched off right now. The <a href="/#live">receipt tape</a> on the home page shows real decisions on Arc Testnet.
      </p>
    );
  }

  const auto = s.items.find((i) => i.step === 'auto');
  const impostor = s.items.find((i) => i.step === 'impostor');
  const cheque = s.items.find((i) => i.step === 'countersign');
  const finished = s.items.length > 0 && !live;

  return (
    <>
      <section className="dm-head">
        <div>
          <h1>Countersign a real payment on Arc Testnet.</h1>
          <p className="lede">
            Behind this page is a Circle wallet with test USDC and a mandate that lets an agent pay cents on its own. Run the agent: it sends three
            bills. Two decide themselves. The third waits for your signature.
          </p>
          <div className="dm-run">
            <button type="button" className="cq-hold" onClick={run} disabled={busy || live || s.runsLeftToday === 0}>
              {busy ? 'Sending the bills…' : s.items.length ? 'Run the agent again' : 'Run the agent'}
            </button>
            <span>
              {s.runsLeftToday > 0 ? `${s.runsLeftToday} runs left today` : 'Today’s budget is spent; it resets at 00:00 UTC'}
            </span>
          </div>
          {err && (
            <p className="dm-err" role="alert">
              {err}
            </p>
          )}
        </div>
        <aside className="slip" aria-label="The demo mandate">
          <div className="slip-top">
            <b>The mandate</b>
            <span>version {m.version}, signed by the owner</span>
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
                {s.balance && <span>{Number(s.balance).toFixed(2)} USDC on Arc Testnet</span>}
              </dd>
            </div>
          </dl>
        </aside>
      </section>

      {s.items.length > 0 && (
        <section className="dm-bills" aria-label="The agent's three bills" aria-live="polite">
          {auto && (
            <Row n={1} item={auto} onChange={refresh} title={auto.status === 'PAID' ? 'Paid on its own' : 'Inside the mandate, so it runs'}>
              Oceanic Freight is a pinned payee and {two(auto.amount)} is under the {two(m.perTx)} cap. Twokey sent it through the Circle wallet
              without asking anyone.
            </Row>
          )}
          {impostor && (
            <Row n={2} item={impostor} onChange={refresh} title="Refused before it reached Circle">
              Same name as a pinned payee, different address: the pattern of an invoice-redirect scam. A pinned payee can only be paid at its own
              address, and no approval can override that.
            </Row>
          )}
          {cheque && (
            <Row n={3} item={cheque} onChange={refresh} title={titleFor(cheque)}>
              {noteFor(cheque, two(m.perTx))}
            </Row>
          )}
        </section>
      )}

      {finished && (
        <p className="dm-done">
          That was the whole loop: two decisions made by the mandate, one by you, each written to a hash-chained audit log
          {[auto, cheque].some((i) => i?.txHash) ? ', with the Arc transactions linked above' : ''}. Run it again, or try the other ending this time.
        </p>
      )}
    </>
  );
}

/** One bill: what happened, in words, beside the document it happened to. */
function Row({ n, item, title, onChange, children }: { n: number; item: DemoItem; title: string; onChange: () => Promise<void>; children: React.ReactNode }) {
  return (
    <div className="dm-row" style={{ animationDelay: `${(n - 1) * 220}ms` }}>
      <div className="dm-note">
        <span className="dm-n">{n}</span>
        <div>
          <b>{title}</b>
          <p>{children}</p>
        </div>
      </div>
      {item.step === 'countersign' ? <LiveCheque item={item} onChange={onChange} /> : <Stub item={item} />}
    </div>
  );
}

function noteFor(i: DemoItem, cap: string) {
  switch (i.status) {
    case 'AWAITING_APPROVAL':
      return `Brightline Media is not in the mandate and ${two(i.amount)} is over the ${cap} cap. Twokey sealed the exact terms. Hold to sign them, or let the agent change a cent first and see what happens.`;
    case 'QUEUED':
    case 'SUBMITTED':
      return 'Twokey pauses a few seconds, rebuilds the terms from the payment as it will be sent, checks your seal against them, then calls Circle.';
    case 'PAID':
      return 'Your signature covered these exact terms, and they still matched when Twokey sent the payment through the Circle wallet.';
    case 'VOIDED':
      return 'The payment no longer matched the terms you were shown, so your signature does not cover it. No Circle call was made.';
    case 'REJECTED':
      return 'You refused it. Nothing was sent, and the refusal is in the audit log.';
    case 'EXPIRED':
      return 'Nobody signed within ten minutes, so it expired. Nothing was sent.';
    default:
      return 'Circle did not confirm this payment, and Twokey does not retry it on its own.';
  }
}

function titleFor(i: DemoItem) {
  switch (i.status) {
    case 'AWAITING_APPROVAL':
      return 'Waiting for your countersignature';
    case 'QUEUED':
    case 'SUBMITTED':
      return 'Countersigned, sending on Arc';
    case 'PAID':
      return 'Paid with your countersignature';
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

function Stamp({ item }: { item: DemoItem }) {
  switch (item.status) {
    case 'PAID':
      return (
        <div className="stamp paid-stamp">
          Paid on Arc
          <small>{item.seconds !== null ? `${item.seconds.toFixed(1)} s` : 'final'}</small>
        </div>
      );
    case 'BLOCKED':
      return <div className="stamp void-stamp sm">Blocked</div>;
    case 'VOIDED':
      return <div className="stamp void-stamp">Void</div>;
    case 'REJECTED':
      return <div className="stamp void-stamp sm">Refused</div>;
    case 'EXPIRED':
      return <div className="stamp void-stamp sm">Expired</div>;
    default:
      return null;
  }
}

function TxLine({ item }: { item: DemoItem }) {
  if (item.txHash) {
    return (
      <a href={explorerTx(item.txHash)} target="_blank" rel="noreferrer">
        Arc tx {short(item.txHash)}
      </a>
    );
  }
  if (item.status === 'QUEUED' || item.status === 'SUBMITTED') return <span>Sending through the Circle wallet…</span>;
  if (item.status === 'BLOCKED') return <span>Nothing was sent. No Circle call was made.</span>;
  if (item.status === 'FAILED' || item.status === 'NEEDS_HUMAN') return <span>Circle did not confirm this one; it is not retried.</span>;
  return null;
}

/** A compact cheque for the bills that decide themselves. */
function Stub({ item }: { item: DemoItem }) {
  return (
    <div className={`cheque stub${item.status === 'BLOCKED' ? ' is-void' : ''}`}>
      <div className="cq-top">
        <span>
          <b>Treasury</b> {item.memo}
        </span>
      </div>
      <div className="cq-payto">
        <span className="cq-k">Pay to the order of</span>
        <span className="cq-v">{item.payee ?? 'Unknown payee'}</span>
        <span className="cq-amt">USDC {six(item.amount)}</span>
      </div>
      <div className="cq-why">
        <span className="cq-seal">to {item.address ?? '—'}</span>
      </div>
      <div className="cq-foot">
        <TxLine item={item} />
      </div>
      <Stamp item={item} />
    </div>
  );
}

/** The one the visitor signs. Everything it shows comes from the server; the hold only sends the seal. */
function LiveCheque({ item, onChange }: { item: DemoItem; onChange: () => Promise<void> }) {
  const sigRef = useRef<SVGPathElement>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState<boolean | null>(null);
  const a = item.approval;
  const pending = item.status === 'AWAITING_APPROVAL' && a?.status === 'PENDING';
  const signed = a?.status === 'APPROVED';
  const inGrace = item.status === 'QUEUED' && signed;
  const sealedAmount = a ? (JSON.parse(a.canonical) as { amount: string }).amount : item.amount;
  const drifted = Number(sealedAmount) !== Number(item.amount);

  const draw = (p: number) => sigRef.current?.style.setProperty('stroke-dashoffset', String(SIG_LEN * (1 - p)));

  // The browser recomputes the seal from the canonical terms, so nobody has to take the server's word for it.
  useEffect(() => {
    if (!a) return;
    let on = true;
    void sha256Hex(a.canonical).then((h) => on && setMatch(`sha256:${h}` === a.seal));
    return () => {
      on = false;
    };
  }, [a]);

  useEffect(() => {
    if (signed || item.status === 'PAID') draw(1);
  }, [signed, item.status]);

  const hold = useHold({
    ms: HOLD_MS,
    onProgress: draw,
    onDone: () => void act('countersign', { seal: a!.seal }, 'Countersigned. Twokey checks the seal once more, then sends.'),
  });

  async function act(path: string, body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const r = (await call(path, { paymentId: item.id, ...body })) as { note?: string; from?: string; to?: string };
      setStatus(r.from ? `The agent changed the amount from ${six(r.from)} to ${six(r.to!)}.` : r.note ? `${ok} ${r.note}` : ok);
    } catch (e) {
      setStatus((e as Error).message.replace(/^./, (c) => c.toUpperCase()) + '.');
      hold.reset();
    }
    await onChange();
    setBusy(false);
  }

  const voidDetail = item.voidDetail;
  return (
    <div className="cq-wrap">
      <div className={`cheque${item.status === 'VOIDED' ? ' is-void' : ''}`}>
        <div className="cq-top">
          <span>
            <b>Treasury</b> Circle wallet on Arc Testnet
          </span>
          <span>{item.memo}</span>
        </div>
        <div className="cq-payto">
          <span className="cq-k">Pay to the order of</span>
          <span className="cq-v">{item.payee ?? 'New payee'}</span>
          <span className="cq-amt">USDC {six(item.amount)}</span>
        </div>
        <div className="cq-words">{words(item.amount)}</div>
        <div className="cq-why">
          {item.failed.map((f) => (
            <span key={f.id}>{f.detail}</span>
          ))}
          {a && (
            <span className="cq-seal">
              Sealed {groups(a.seal)}
              {match === true && ' · your browser recomputed it: matches'}
              {match === false && ' · does not match the terms'}
            </span>
          )}
        </div>
        <div className="cq-sigs">
          <div className="cq-sig">
            <span className="cq-hand">demo-agent</span>
            <span className="cq-line">Requested by the agent</span>
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
        <div className="cq-foot">
          <TxLine item={item} />
        </div>
        <Stamp item={item} />
      </div>

      {(pending || inGrace) && (
        <div className="cq-actions">
          {pending && (
            <button
              type="button"
              className="cq-hold"
              disabled={busy}
              onPointerDown={(e) => {
                e.preventDefault();
                hold.start();
                setStatus('Keep holding: you are signing the sealed terms.');
              }}
              onPointerUp={() => hold.end() && setStatus('Let go too early. Hold until the signature is complete.')}
              onPointerLeave={() => hold.end()}
              onPointerCancel={() => hold.end()}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
                  e.preventDefault();
                  hold.start();
                }
              }}
              onKeyUp={() => hold.end()}
            >
              Hold to countersign
            </button>
          )}
          <button type="button" className="cq-ghost" disabled={busy} onClick={() => !hold.justDone() && void act('drift', {}, '')}>
            Let the agent change a cent
          </button>
          {pending && (
            <button type="button" className="cq-ghost" disabled={busy} onClick={() => void act('refuse', {}, 'Refused. Nothing was sent.')}>
              Refuse
            </button>
          )}
        </div>
      )}

      <p className="cq-status" role="status" aria-live="polite">
        {status && !DONE.has(item.status) && <>{status} </>}
        {pending && drifted && `The agent changed the amount to ${six(item.amount)} after Twokey sealed ${six(sealedAmount)}. Sign anyway and see.`}
        {inGrace && !status && 'Countersigned. Twokey waits a few seconds, rebuilds the terms, checks the seal again, then sends.'}
        {item.status === 'VOIDED' &&
          (voidDetail?.amount_from
            ? `The amount changed from ${six(voidDetail.amount_from)} to ${six(voidDetail.amount_to!)} after it was sealed. The seal no longer matches, so the approval is void and nothing was sent.`
            : 'The terms changed after they were sealed, so the approval is void and nothing was sent.')}
        {item.status === 'PAID' && item.seconds !== null && `Final on Arc ${item.seconds.toFixed(1)} s after your countersignature, counting the pause before sending.`}
      </p>
      {a && (
        <details className="cq-terms">
          <summary>What you are signing</summary>
          <pre>{JSON.stringify(JSON.parse(a.canonical), null, 2)}</pre>
          <p>
            The seal is SHA-256 over these terms in one canonical form (RFC 8785): <code>{a.seal}</code>
          </p>
        </details>
      )}
    </div>
  );
}
