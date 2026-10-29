'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CopyButton } from './client';
import { HoldButton } from './hold-button';

async function post(url: string, csrf: string, body: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, ...extra }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: { message: string } } & Record<string, unknown>;
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json;
}

/** Email, password and a workspace name: a sandbox on Arc Testnet, no card. */
export function SignupForm() {
  const router = useRouter();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="su-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr('');
        const f = new FormData(e.currentTarget);
        try {
          await post('/api/auth/signup', '', { email: f.get('email'), password: f.get('password'), workspace: f.get('workspace') });
          router.replace('/app');
        } catch (x) {
          setErr((x as Error).message);
          setBusy(false);
        }
      }}
    >
      <label>
        Work email
        <input className="input" name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input className="input" name="password" type="password" autoComplete="new-password" minLength={12} required placeholder="12 characters or more" />
      </label>
      <label>
        Workspace name
        <input className="input" name="workspace" minLength={2} maxLength={40} required placeholder="Northwind Ops" />
      </label>
      <button className="btn btn-ink" type="submit" disabled={busy}>
        {busy ? 'Creating your sandbox…' : 'Create my sandbox'}
      </button>
      <div className="err" role="alert">
        {err}
      </div>
    </form>
  );
}

export interface PayeeDraft {
  name: string;
  address: string;
}

/** Step 3: limits and pinned payees, then a hold to sign mandate v1 (or the next version). */
export function MandateWizard({ csrf, defaults, version }: { csrf: string; defaults: PayeeDraft[]; version: number }) {
  const router = useRouter();
  const [perTx, setPerTx] = useState('0.50');
  const [daily, setDaily] = useState('1.50');
  const [hard, setHard] = useState('5.00');
  const [payees, setPayees] = useState<PayeeDraft[]>(defaults);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const set = (n: number, k: keyof PayeeDraft, v: string) => setPayees((p) => p.map((x, i) => (i === n ? { ...x, [k]: v } : x)));

  return (
    <div className="wz">
      <div className="wz-lim">
        <label>
          Per payment
          <span className="input-u">
            <input className="input" inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} />
            <em>USDC</em>
          </span>
        </label>
        <label>
          Per day
          <span className="input-u">
            <input className="input" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
            <em>USDC</em>
          </span>
        </label>
        <label>
          Never above
          <span className="input-u">
            <input className="input" inputMode="decimal" value={hard} onChange={(e) => setHard(e.target.value)} />
            <em>USDC</em>
          </span>
        </label>
      </div>
      <p className="wz-hint">Sandbox caps: 1.00 per payment, 5.00 a day, 10.00 never-above. Faucet USDC is scarce.</p>

      <div className="wz-payees" role="group" aria-label="Pinned payees">
        <div className="wz-h">
          <b>Pinned payees</b>
          <span>They get paid alone, within the limits. Anyone else waits for you.</span>
        </div>
        {payees.map((p, i) => (
          <div className="wz-row" key={i}>
            <input className="input" aria-label="Payee name" value={p.name} onChange={(e) => set(i, 'name', e.target.value)} placeholder="Payee name" />
            <input className="input mono" aria-label="Payee address" value={p.address} onChange={(e) => set(i, 'address', e.target.value)} placeholder="0x…" spellCheck={false} />
            <button type="button" className="wz-x" aria-label={`Remove ${p.name || 'payee'}`} onClick={() => setPayees((x) => x.filter((_, j) => j !== i))} disabled={payees.length <= 1}>
              ×
            </button>
          </div>
        ))}
        {payees.length < 5 && (
          <button type="button" className="wz-add" onClick={() => setPayees((x) => [...x, { name: '', address: '' }])}>
            + Add a payee you trust
          </button>
        )}
      </div>

      <div className="focus wz-sign">
        <div className="f-top">
          <b>Mandate v{version}</b>
          <small>signed with your hold</small>
        </div>
        <p>
          {payees.filter((p) => p.name).length} pinned payee{payees.filter((p) => p.name).length === 1 ? '' : 's'} up to {perTx || '—'} each, {daily || '—'} a day. New payees and
          anything above wait for you. Nothing above {hard || '—'}, ever.
        </p>
        <HoldButton
          key={nonce}
          label={busy ? 'Signing…' : `Hold to sign mandate v${version}`}
          disabled={busy}
          onDone={async () => {
            setBusy(true);
            setErr('');
            try {
              await post('/api/v1/setup/mandate', csrf, { per_tx: perTx, daily, hard_max_per_tx: hard, payees });
              router.replace('/app?setup=next');
              router.refresh();
            } catch (x) {
              setErr((x as Error).message);
              setBusy(false);
              setNonce((n) => n + 1);
            }
          }}
        />
        {err && (
          <p className="f-err" role="alert">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}

/** Step 4: link the owner's Telegram chat, or approve in the console only. */
export function TelegramStep({ csrf, link, linked }: { csrf: string; link: string | null; linked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // While the owner is over in Telegram, watch for the link to land.
  useEffect(() => {
    if (linked) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [linked, router]);
  if (linked) {
    return (
      <div className="tg-done">
        <span className="tg-ic" aria-hidden="true">
          ✈
        </span>
        <div>
          <b>Telegram linked</b>
          <p>Payments outside your mandate will ask you there, with the seal to compare.</p>
        </div>
        <button type="button" className="btn btn-ink" onClick={() => router.replace('/app?setup=next')}>
          Continue
        </button>
      </div>
    );
  }
  return (
    <div className="tg">
      {link ? (
        <a className="tg-link" href={link} target="_blank" rel="noreferrer">
          <span className="tg-ic" aria-hidden="true">
            ✈
          </span>
          <span>
            <b>Link Telegram</b>
            <small>Opens the Twokey bot with a one-time code. Press Start there.</small>
          </span>
        </a>
      ) : (
        <p className="wz-hint">Telegram isn&apos;t set up on this deployment. Approve in the console.</p>
      )}
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await post('/api/v1/setup/telegram-skip', csrf, {}).catch(() => undefined);
          router.replace('/app?setup=next');
          router.refresh();
        }}
      >
        Skip, approve in the console only
      </button>
    </div>
  );
}

/**
 * A silver layer over the key. Drag across it to scratch it off; past ~45% it falls away. The key exists
 * before the scratch (it came back from the server): the scratch is a deliberate "this is shown once" beat.
 */
function Scratch({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr;
    c.height = r.height * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    const grad = g.createLinearGradient(0, 0, r.width, r.height);
    grad.addColorStop(0, '#c7cad1');
    grad.addColorStop(0.5, '#e6e8ec');
    grad.addColorStop(1, '#b5b9c1');
    g.fillStyle = grad;
    g.fillRect(0, 0, r.width, r.height);
    g.strokeStyle = 'rgba(255,255,255,.35)';
    for (let x = -r.height; x < r.width; x += 6) {
      g.beginPath();
      g.moveTo(x, r.height);
      g.lineTo(x + r.height, 0);
      g.stroke();
    }
    g.fillStyle = '#4a4e56';
    g.font = '500 12px system-ui';
    g.textAlign = 'center';
    g.fillText('Scratch to reveal your agent key', r.width / 2, r.height / 2 + 4);
  }, []);

  const scratch = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons !== 1 && e.pointerType === 'mouse') return;
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(e.clientX - r.left, e.clientY - r.top, 18, 0, Math.PI * 2);
    g.fill();
  };
  const check = () => {
    const c = ref.current!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let clear = 0;
    for (let i = 3; i < d.length; i += 64) if (d[i] === 0) clear++;
    if (clear / (d.length / 64) > 0.45) {
      setGone(true);
      onClear();
    }
  };
  return (
    <div className={`scr${gone ? ' gone' : ''}`}>
      {children}
      {!gone && (
        <>
          <canvas ref={ref} onPointerDown={scratch} onPointerMove={scratch} onPointerUp={check} onPointerLeave={check} aria-hidden="true" />
          <button
            type="button"
            className="scr-skip"
            onClick={() => {
              setGone(true);
              onClear();
            }}
          >
            Reveal
          </button>
        </>
      )}
    </div>
  );
}

export interface BadgeFacts {
  workspace: string;
  agentId: string;
  treasury: string;
  perTx: string;
  daily: string;
  hardMax: string;
  payees: { id: string; name: string }[];
  telegram: boolean;
  baseUrl: string;
}

/** Step 5: the agent's badge. Issue the key, scratch it off, hand it to the agent, or send a first payment from here. */
export function AgentBadge({ csrf, facts, hasKey }: { csrf: string; facts: BadgeFacts; hasKey: boolean }) {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [shown, setShown] = useState(false);
  const [tab, setTab] = useState<'curl' | 'ts' | 'mcp'>('curl');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const k = shown ? key : 'tk_agent_…';
  const payee = facts.payees[0];
  const snippet = {
    curl: `curl ${facts.baseUrl}/api/v1/payments \\
  -H "Authorization: Bearer ${k}" \\
  -H "Idempotency-Key: inv-4471-freight" \\
  -d '{"payee":{"payeeId":"${payee?.id ?? 'pay_…'}"},"amount":"0.10","memo":"INV-4471"}'`,
    ts: `import { createTwokey } from '@twokey-arc/sdk';

const { agent } = createTwokey({ baseUrl: '${facts.baseUrl}', apiKey: '${k}' });
const p = await agent.guard(
  { payee: { payeeId: '${payee?.id ?? 'pay_…'}' }, amount: '0.10', memo: 'INV-4471' },
  { agentId: '${facts.agentId}', idempotencyKey: 'inv-4471-freight' },
);`,
    mcp: `# Claude Code, Cursor: the Twokey MCP server
TWOKEY_URL=${facts.baseUrl}
TWOKEY_AGENT_KEY=${k}
twokey-mcp`,
  }[tab];

  return (
    <div className="bdg-wrap">
      <div className="bdg-stage" aria-label={`Badge for ${facts.agentId}`}>
        <span className="bdg-lan" aria-hidden="true" />
        <span className="bdg-clip" aria-hidden="true" />
        <div className={`bdg${key ? ' live' : ''}`}>
          <div className="bdg-slot" aria-hidden="true" />
          <div className="bdg-top">
            <div className="bdg-face" aria-hidden="true">
              ap
            </div>
            <div>
              <b>{facts.agentId}</b>
              <small>Accounts payable · {facts.workspace}</small>
            </div>
          </div>
          <div className="bdg-grid">
            <div>
              <small>Per payment</small>
              <b>{facts.perTx}</b>
            </div>
            <div>
              <small>Per day</small>
              <b>{facts.daily}</b>
            </div>
            <div>
              <small>Pays alone</small>
              <b>
                {facts.payees.length} payee{facts.payees.length === 1 ? '' : 's'}
              </b>
            </div>
            <div>
              <small>Never above</small>
              <b>{facts.hardMax}</b>
            </div>
            <div>
              <small>Asks</small>
              <b>{facts.telegram ? 'Telegram + console' : 'Console'}</b>
            </div>
            <div className={key ? 'on' : ''}>
              <small>Key</small>
              <b>{key ? (shown ? 'issued' : 'scratch me') : hasKey ? 'issued earlier' : 'not yet'}</b>
            </div>
          </div>
          <div className="bdg-bars" aria-hidden="true" />
          <div className="bdg-stamp">
            TREASURY · ARC TESTNET
            <br />
            {facts.treasury.slice(0, 6)}…{facts.treasury.slice(-4)}
          </div>
        </div>
      </div>

      <div className="bdg-side">
        {!key ? (
          <>
            <p>
              The badge is the mandate the agent carries into every payment. Its key can only <b>ask</b>: it never approves, and it never sees a wallet id.
              {hasKey && ' Issuing a new key revokes the old one.'}
            </p>
            <button
              type="button"
              className="btn btn-ink"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErr('');
                try {
                  const r = (await post('/api/v1/agents/key', csrf, {})) as { apiKey: string };
                  setKey(r.apiKey);
                } catch (x) {
                  setErr((x as Error).message);
                }
                setBusy(false);
              }}
            >
              {hasKey ? 'Issue a new key' : 'Issue the agent key'}
            </button>
          </>
        ) : (
          <>
            <Scratch onClear={() => setShown(true)}>
              <div className="scr-key mono">{key}</div>
            </Scratch>
            {shown && (
              <p className="wz-hint">
                Shown once: Twokey keeps only its hash. <CopyButton text={key} label="Copy key" />
              </p>
            )}
            <div className="tabs" role="tablist">
              {(['curl', 'ts', 'mcp'] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                  {t === 'ts' ? 'TypeScript' : t === 'mcp' ? 'MCP' : 'curl'}
                </button>
              ))}
            </div>
            <pre className="code">{snippet}</pre>
            {payee && shown && (
              <button
                type="button"
                className="btn btn-lime"
                disabled={busy || !!sent}
                onClick={async () => {
                  // The browser acts as the agent here: same key, same endpoint, same rules as your agent.
                  setBusy(true);
                  setErr('');
                  try {
                    const r = await fetch('/api/v1/payments', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'idempotency-key': `first-${Date.now()}` },
                      body: JSON.stringify({ payee: { payeeId: payee.id }, amount: '0.10', memo: 'First payment from the setup' }),
                    });
                    const j = (await r.json()) as { status?: string; error?: { message: string } };
                    if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
                    setSent(j.status ?? 'sent');
                    setTimeout(() => {
                      router.replace('/app');
                      router.refresh();
                    }, 900);
                  } catch (x) {
                    setErr((x as Error).message);
                  }
                  setBusy(false);
                }}
              >
                {sent ? 'Sent: watch the inbox' : `Send a test payment: 0.10 to ${payee.name}`}
              </button>
            )}
          </>
        )}
        {err && (
          <p className="err" role="alert">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}

/** Once, the first time a workspace's first payment shows up. */
export function FirstPaymentToast({ id, text }: { id: string; text: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const k = `tk_first_${id}`;
      if (localStorage.getItem(k)) return;
      localStorage.setItem(k, '1');
    } catch {
      return;
    }
    setShow(true);
    const t = setTimeout(() => setShow(false), 6000);
    return () => clearTimeout(t);
  }, [id]);
  if (!show) return null;
  return (
    <div className="toast" role="status">
      <i aria-hidden="true" /> {text}
    </div>
  );
}
