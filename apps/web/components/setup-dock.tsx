import Link from 'next/link';
import type { Mandate } from '@twokey-arc/policy';
import { sandboxAgentId, type SetupState, type SetupStep } from '@twokey-arc/core';
import type { InboxItem } from './inbox';
import { AgentBadge, MandateWizard, TelegramStep, type PayeeDraft } from './setup';

const STEPS: { step: SetupStep; title: string }[] = [
  { step: 'account', title: 'Create your account' },
  { step: 'treasury', title: 'Fund the treasury (faucet)' },
  { step: 'mandate', title: 'Sign your mandate' },
  { step: 'telegram', title: 'Link Telegram for approvals' },
  { step: 'key', title: 'Issue an agent key' },
];

/** Payees a new sandbox can pin straight away: Twokey's own testnet wallets, so test payments have somewhere to land. */
export const DEMO_PAYEES: PayeeDraft[] = [
  { name: 'Oceanic Freight', address: '0xae403e2c24b6a808cab4936d26c6394351cbf3d0' },
  { name: 'Harbor Cloud', address: '0x6043da8fd6924c04e249347f4e52c438200135d6' },
];

/** What the empty lanes show until real traffic arrives, tagged as examples. */
export const SANDBOX_EXAMPLES: InboxItem[] = [
  { id: 'ex1', payee: 'Northwind Ads', amount: '1.20', lane: 'wait', note: 'New payee: waits for your signature', meta: 'ap-agent', example: true },
  { id: 'ex2', payee: 'Harbor Cloud', amount: '0.40', lane: 'run', note: 'Inside the mandate', meta: 'submitted to Arc', example: true },
  { id: 'ex3', payee: 'Oceanic Freight', amount: '0.25', lane: 'paid', note: 'Paid on its own, within 0.50', meta: '4.1 s on Arc', example: true },
  { id: 'ex4', payee: '"Oceanic Freight"', amount: '0.04', lane: 'stopped', note: 'Pinned name, different address', meta: 'nothing sent', example: true },
];

const HEAD: Record<string, { title: string; sub: string }> = {
  treasury: { title: 'Setting up your sandbox', sub: 'Every step is a real call on Arc Testnet.' },
  mandate: { title: 'What can your agent pay on its own?', sub: 'Inside these lines it pays and tells you after. Outside them it asks first. Every version is kept.' },
  telegram: { title: 'Who signs when it asks?', sub: 'You, here in the console, and on Telegram if you link it.' },
  key: { title: "Your agent's badge", sub: 'It carries your mandate into every payment. Its key can ask; it can never approve.' },
  mainnet: { title: 'Ready for real money?', sub: 'Mainnet runs on your own Circle account, so the keys to your treasury stay yours.' },
};

export function SetupLayer(p: {
  st: SetupState;
  open: string | undefined;
  csrf: string;
  balance: string | null;
  mandate: Mandate | null;
  telegramLink: string | null;
  telegramLinked: boolean;
  baseUrl: string;
}) {
  const { st, open } = p;
  const doneN = STEPS.filter((s) => st.done[s.step]).length;
  const all = doneN === STEPS.length;
  const head = open ? HEAD[open] : undefined;

  return (
    <>
      {!open && (
        <aside className={`dock${all ? ' all' : ''}`} aria-label="Set up Twokey">
          <div className="dock-h">
            <b>{all ? "✓ You're set up" : 'Get Twokey ready'}</b>
            <small>
              {doneN} / {STEPS.length}
            </small>
          </div>
          {!all && (
            <div className="dock-pr" aria-hidden="true">
              <i style={{ width: `${(doneN / STEPS.length) * 100}%` }} />
            </div>
          )}
          {all ? (
            <Link className="dock-go" href="/app?setup=mainnet">
              Mainnet
            </Link>
          ) : (
            <ol>
              {STEPS.map((s, i) => {
                const done = st.done[s.step];
                const next = st.next === s.step;
                return (
                  <li key={s.step} className={done ? 'd' : next ? 'n' : ''}>
                    <i aria-hidden="true">{done ? '✓' : i + 1}</i>
                    <span>{s.title}</span>
                    {next && s.step !== 'treasury' && (
                      <Link className="dock-go" href={`/app?setup=${s.step}`}>
                        Start
                      </Link>
                    )}
                    {next && s.step === 'treasury' && <em className="dock-wait">working…</em>}
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      )}

      {open && head && (
        <div className="setup-sheet" role="dialog" aria-modal="false" aria-labelledby="setup-title">
          <div className="ss-h">
            <div>
              <h2 id="setup-title">{head.title}</h2>
              <p>{head.sub}</p>
            </div>
            <Link className="ss-x" href="/app" aria-label="Close">
              ×
            </Link>
          </div>

          {open === 'treasury' && <Provisioning st={st} balance={p.balance} />}
          {open === 'mandate' &&
            (st.done.treasury ? (
              <MandateWizard
                csrf={p.csrf}
                version={(p.mandate?.version ?? 0) + 1}
                defaults={p.mandate ? p.mandate.payees.map((x) => ({ name: x.name, address: x.address })) : DEMO_PAYEES}
              />
            ) : (
              <Provisioning st={st} balance={p.balance} />
            ))}
          {open === 'telegram' && <TelegramStep csrf={p.csrf} link={p.telegramLink} linked={p.telegramLinked} />}
          {open === 'key' &&
            (p.mandate ? (
              <AgentBadge
                csrf={p.csrf}
                hasKey={!!st.agentId}
                facts={{
                  workspace: st.org.name,
                  agentId: st.agentId ?? sandboxAgentId(st.org.id),
                  treasury: st.org.walletAddress ?? '',
                  perTx: Number(p.mandate.limits.per_tx).toFixed(2),
                  daily: Number(p.mandate.limits.daily).toFixed(2),
                  hardMax: Number(p.mandate.limits.hard_max_per_tx).toFixed(2),
                  payees: p.mandate.payees.map((x) => ({ id: x.payee_id, name: x.name })),
                  telegram: p.telegramLinked,
                  baseUrl: p.baseUrl,
                }}
              />
            ) : (
              <p className="wz-hint">
                Sign your mandate first: the badge prints its limits. <Link href="/app?setup=mandate">Open the mandate step</Link>
              </p>
            ))}
          {open === 'mainnet' && <Mainnet />}
        </div>
      )}
    </>
  );
}

function Provisioning({ st, balance }: { st: SetupState; balance: string | null }) {
  const o = st.org;
  const row = (state: 'ok' | 'run' | 'wait' | 'bad', title: string, sub: React.ReactNode) => (
    <li className={state}>
      <i aria-hidden="true">{state === 'ok' ? '✓' : state === 'run' ? '↻' : state === 'bad' ? '!' : '·'}</i>
      <div>
        {title}
        <small>{sub}</small>
      </div>
    </li>
  );
  const funded = balance !== null && Number(balance) > 0;
  return (
    <>
      <ul className="prov">
        {row('ok', 'Workspace created', `${o.id} · you are the owner`)}
        {o.status === 'FAILED'
          ? row('bad', 'Circle wallet could not be created', o.provisionError ?? 'try again later')
          : row(o.walletAddress ? 'ok' : 'run', 'Circle wallet on Arc Testnet', o.walletAddress ? <span className="mono">{o.walletAddress}</span> : 'developer-controlled, usually a few seconds')}
        {row(
          funded ? 'ok' : o.walletAddress ? 'run' : 'wait',
          funded ? 'Test USDC arrived' : 'Asking the Circle faucet for test USDC',
          funded ? `${Number(balance).toFixed(2)} USDC in the treasury` : o.walletAddress ? 'usually 5 to 30 seconds' : 'after the wallet',
        )}
      </ul>
      {o.walletAddress && !funded && (
        <p className="wz-hint">
          Nothing yet? Fund it yourself at{' '}
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
            faucet.circle.com
          </a>{' '}
          (Arc Testnet, USDC) with the address above.
        </p>
      )}
      {o.walletAddress && (
        <Link className="btn btn-ink" href="/app?setup=mandate" style={{ marginTop: 16 }}>
          Continue to your mandate
        </Link>
      )}
    </>
  );
}

function Mainnet() {
  return (
    <div className="mn">
      <p>
        The sandbox runs on Twokey&apos;s testnet Circle account. For real USDC, Twokey runs on <b>your</b> Circle account instead, so nobody else ever
        holds the keys to your treasury. It is the same code that runs Twokey&apos;s own treasury on Arc mainnet today.
      </p>
      <ol>
        <li>Open Circle Console in Live mode, add billing, and create a LIVE API key.</li>
        <li>Generate and register your entity secret there; keep the recovery file.</li>
        <li>
          Deploy Twokey with <span className="mono">TWOKEY_NETWORK=mainnet</span> and your keys, then run <span className="mono">pnpm mainnet:launch</span>: it
          creates your wallets and waits for your first USDC.
        </li>
        <li>Sign your mainnet mandate and issue your agent a key, exactly as here.</li>
      </ol>
      <p className="wz-hint">Design partners get help with every step. Your sandbox stays as it is.</p>
    </div>
  );
}
