'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/** Re-renders the server page every few seconds so statuses move without a reload. */
export function AutoRefresh({ ms = 2000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label={`${label} ${text}`}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

async function post(url: string, csrf: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: { message: string }; note?: string };
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json;
}

const HOLD_MS = 1200;

/**
 * Press and hold for 1.2 s, or press Enter, to approve these exact terms. The seal shown is the seal sent:
 * the server answers 409 if anything moved since the card rendered.
 */
export function ApprovalActions({ approvalId, paymentId, seal, csrf }: { approvalId: string; paymentId: string; seal: string; csrf: string }) {
  const router = useRouter();
  const path = usePathname();
  // On Today, pin the panel to this payment; otherwise it would jump to the next one waiting.
  const stay = () => (path === '/' ? router.replace(`/?id=${paymentId}`) : router.refresh());
  const btn = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const hold = useRef({ p: 0, holding: false, last: 0, raf: 0 });

  async function approve() {
    if (busy) return;
    setBusy(true);
    setStatus('Approving these exact terms…');
    try {
      const r = await post(`/api/v1/approvals/${approvalId}/approve`, csrf, { seal });
      setStatus(r.note ? `Approved · ${r.note}` : 'Approved · sending on Arc…');
      stay();
    } catch (e) {
      setStatus((e as Error).message);
      setBusy(false);
      router.refresh();
    }
  }

  function tick(now: number) {
    const h = hold.current;
    const dt = now - h.last;
    h.last = now;
    h.p = Math.max(0, Math.min(1, h.p + (h.holding ? dt / HOLD_MS : -dt / 250)));
    btn.current?.style.setProperty('--p', h.p.toFixed(3));
    if (h.p >= 1) {
      h.holding = false;
      h.p = 0;
      btn.current?.style.setProperty('--p', '0');
      void approve();
      return;
    }
    if (h.holding || h.p > 0) h.raf = requestAnimationFrame(tick);
  }
  const start = () => {
    if (busy) return;
    const h = hold.current;
    h.holding = true;
    h.last = performance.now();
    cancelAnimationFrame(h.raf);
    h.raf = requestAnimationFrame(tick);
  };
  const end = () => {
    const h = hold.current;
    if (!h.holding) return;
    h.holding = false;
    if (h.p < 1) setStatus('Keep holding to approve');
  };

  async function reject(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await post(`/api/v1/approvals/${approvalId}/reject`, csrf, { reason });
      setStatus('Rejected · nothing was sent');
      stay();
    } catch (err) {
      setStatus((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="acts">
        <button className="btn btn-dark" type="button" disabled={busy} onClick={() => setRejecting((v) => !v)}>
          Reject
        </button>
        <button
          ref={btn}
          className="btn approve"
          type="button"
          disabled={busy}
          aria-describedby="hold-hint"
          onPointerDown={(e) => {
            e.preventDefault();
            start();
          }}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          onClick={(e) => {
            // Keyboard (Enter / Space) arrives as a click with detail 0: approve at once.
            if (e.detail === 0) void approve();
          }}
        >
          Hold to approve
        </button>
      </div>
      <p className="hint" id="hold-hint">
        Press and hold, or press Enter, to approve these exact terms.
      </p>
      {rejecting && (
        <form className="reject-form" onSubmit={reject}>
          <input className="input" aria-label="Reason for rejecting" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <button className="btn btn-dark" type="submit" disabled={busy || !reason.trim()}>
            Reject
          </button>
        </form>
      )}
      <p className="hint" role="status" aria-live="polite">
        {status}
      </p>
    </>
  );
}

export function VerifyChain({ initial }: { initial: { ok: boolean; length: number; head: string; firstBrokenSeq?: number } }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <div className="verify">
      <button
        className="btn btn-dark btn-sm"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await fetch('/api/v1/audit/verify', { cache: 'no-store' });
          setV(await r.json());
          setBusy(false);
        }}
      >
        Verify chain
      </button>
      <span className={`st ${v.ok ? 'paid' : 'block'}`} role="status" aria-live="polite">
        {v.ok ? `Chain intact · ${v.length} entries` : `Broken at #${v.firstBrokenSeq}`}
      </span>
    </div>
  );
}

/** DEMO_MODE only: re-round an amount to show the seal voiding the approval. */
export function DriftButton({ paymentId, csrf }: { paymentId: string; csrf: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState('');
  return (
    <p className="hint">
      <button
        type="button"
        className="copy"
        onClick={async () => {
          try {
            const r = (await post(`/api/demo/drift/${paymentId}`, csrf, { delta: '0.50' })) as unknown as { from: string; to: string };
            setMsg(`Demo: agent changed the amount ${r.from} → ${r.to}`);
          } catch (e) {
            setMsg((e as Error).message);
          }
          router.refresh();
        }}
      >
        Demo: drift +0.50
      </button>{' '}
      {msg}
    </p>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.get('email'), password: f.get('password') }) });
        if (res.ok) router.replace('/');
        else {
          setErr('Email or password is wrong.');
          setBusy(false);
        }
      }}
    >
      <h1>Sign in to Twokey</h1>
      <p>Owner and approver for the Arc Testnet treasury.</p>
      <label>
        Email
        <input className="input" name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Password
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      <button className="btn btn-light" type="submit" disabled={busy}>
        Sign in
      </button>
      <div className="err" role="alert">
        {err}
      </div>
    </form>
  );
}

export function SignOut({ csrf }: { csrf: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="copy"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': csrf } });
        router.replace('/login');
      }}
    >
      Sign out
    </button>
  );
}

/** Owner issues (or rotates) the agent key. It is shown once, here, and never again. */
export function IssueAgentKey({ csrf }: { csrf: string }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3>Agent key (accounts payable agent)</h3>
      {key ? (
        <>
          <p>Copy it now: it won&apos;t be shown again. The previous key no longer works.</p>
          <p className="mono" style={{ color: 'var(--text)', overflowWrap: 'anywhere', margin: '8px 0' }}>{key}</p>
          <CopyButton text={key} />
        </>
      ) : (
        <>
          <p>Issuing a new key revokes the old one. The agent can only request payments; it can never approve.</p>
          <button
            type="button"
            className="btn btn-dark btn-sm"
            style={{ marginTop: 10 }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = (await post('/api/v1/agents/key', csrf, {})) as unknown as { apiKey: string };
                setKey(r.apiKey);
              } catch (e) {
                setErr((e as Error).message);
              }
              setBusy(false);
            }}
          >
            Issue agent key
          </button>
          {err && <p className="err">{err}</p>}
        </>
      )}
    </div>
  );
}
