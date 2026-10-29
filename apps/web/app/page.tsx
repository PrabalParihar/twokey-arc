import type { Metadata } from 'next';
import Link from 'next/link';
import './landing.css';
import { Inbox, laneOf, type InboxItem } from '@/components/inbox';
import { SignatureCard } from '@/components/signature-card';
import { explorerTx, TESTNET_EXPLORER } from '@/lib/explorer';
import { networkName } from '@/lib/format';
import { publicStats, recentReceipts, type PublicStats, type Receipt } from '@/lib/public-stats';
import { cfg, DEMO_ENABLED, demoCfg, SANDBOX_ENABLED } from '@/lib/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Twokey on Arc: two signatures for every agent payment',
  description:
    'Your AI agent pays the USDC bills you expect on Arc, asks you before the rest, and never pays a stranger. Sealed approvals over Circle Wallets.',
};

const ist = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const short = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const amt = (a: string) => Number(a).toFixed(2);

const EXAMPLES: InboxItem[] = [
  { id: 'ex1', payee: 'Northwind Ads', amount: '1.20', lane: 'wait', note: 'New payee, over the 0.50 cap. Sealed 6e47 3773, waiting for you.', meta: 'ap-agent · 2 min ago', example: true },
  { id: 'ex2', payee: 'Brightline Media', amount: '0.75', lane: 'wait', note: 'Over the daily auto cap. Sealed d665 04a9.', meta: 'ap-agent · 9 min ago', example: true },
  { id: 'ex3', payee: 'Harbor Cloud', amount: '0.40', lane: 'run', note: 'Inside the mandate. Circle transfer created, settling on Arc.', meta: 'about 3 s to final', example: true },
  { id: 'ex4', payee: 'Oceanic Freight', amount: '0.25', lane: 'run', note: 'Signed by the owner. Seal re-checked, sending.', meta: 'ap-agent · just now', example: true },
];

/** Why a public receipt landed in its lane, in a few words. */
function why(r: Receipt): string {
  const who = r.demo ? 'a demo visitor' : 'the owner';
  switch (r.status) {
    case 'PAID':
      return r.approved ? `Signed by ${who}` : 'Inside the mandate';
    case 'QUEUED':
    case 'SUBMITTED':
      return r.approved ? `Signed by ${who}, sending` : 'Inside the mandate, sending';
    case 'AWAITING_APPROVAL':
      return 'New payee or over a cap, sealed';
    case 'BLOCKED':
      return 'Known payee at a new address';
    case 'VOIDED':
      return 'Changed after signing. Seal void';
    case 'REJECTED':
      return `Refused by ${who}`;
    case 'EXPIRED':
      return 'Nobody signed in time';
    default:
      return r.ruleId;
  }
}

async function load(): Promise<{ s: PublicStats | null; own: number; demo: number; tape: Receipt[] }> {
  try {
    // With the public demo on, visitors' runs count too: they are real decisions on Arc Testnet.
    const [own, demoStats, ownTape, demoTape] = await Promise.all([
      publicStats(),
      DEMO_ENABLED ? publicStats(demoCfg.orgId) : null,
      recentReceipts(undefined, 30),
      DEMO_ENABLED ? recentReceipts(demoCfg.orgId, 30) : [],
    ]);
    const s = demoStats ? { ...own, paid: own.paid + demoStats.paid, last: own.last ?? demoStats.last } : own;
    const tape = [...ownTape, ...demoTape].sort((a, b) => b.at.getTime() - a.at.getTime());
    return { s, own: own.paid, demo: demoStats?.paid ?? 0, tape };
  } catch {
    return { s: null, own: 0, demo: 0, tape: [] };
  }
}

export default async function Landing() {
  const { s, own, demo, tape } = await load();
  return (
    <div className="lp">
      <div className="wrap">
        <nav className="lp-nav" aria-label="Main">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true" /> Twokey
          </Link>
          <div className="lp-links">
            <a href="#live">Live on Arc</a>
            <a href="#seal">The seal</a>
            <a href="#cards">Agent cards</a>
            <a href="#developers">Developers</a>
          </div>
          <div className="lp-cta">
            <Link className="btn btn-sm lp-console" href={SANDBOX_ENABLED ? '/signup' : '/app'}>
              {SANDBOX_ENABLED ? 'Start free' : 'Console'}
            </Link>
            <Link className="btn btn-ink btn-sm" href="/demo">
              Countersign a live payment
            </Link>
          </div>
        </nav>

        <section className="hero">
          <span className="pill">
            <span className="live-dot" /> Live on {networkName(cfg.network)}
            {/* Counted per network: demo payments settle on testnet and must not read as mainnet volume. */}
            {s && cfg.network !== 'ARC' ? ` · ${own + demo} payments settled` : ''}
            {s && cfg.network === 'ARC' && own > 0 ? ` · ${own} settled` : ''}
            {s && cfg.network === 'ARC' && demo > 0 ? ` · ${demo} in the testnet demo` : ''}
          </span>
          <h1 style={{ marginTop: 22 }}>
            Your agent pays the{' '}
            <span className="chip c1">
              <b aria-hidden="true">🧾</b>bills
            </span>{' '}
            you expect, asks{' '}
            <span className="chip c2">
              <b aria-hidden="true">✋</b>you
            </span>{' '}
            before the rest, and never pays a{' '}
            <span className="chip c3">
              <b aria-hidden="true">⊘</b>stranger
            </span>
            .
          </h1>
          <p className="lede">
            Twokey sits between your AI agent and a Circle wallet on Arc. Every USDC payment is decided by your mandate or sealed for your signature,
            and every decision is on a tamper-evident record.
          </p>
          <div className="hero-ctas">
            <Link className="btn btn-ink" href="/demo">
              Countersign a live payment
            </Link>
            {SANDBOX_ENABLED ? (
              <Link className="btn" href="/signup">
                Start a free sandbox
              </Link>
            ) : (
              <a className="btn" href="#seal">
                How the seal works
              </a>
            )}
          </div>

          <div className="window" id="live" aria-label="Live decisions">
            <div className="window-bar">
              <span className="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="url">twokey.si/app · inbox</span>
              <span className="live">
                <i /> Live from Arc
              </span>
            </div>
            <div className="window-body">
              <aside className="w-side" aria-hidden="true">
                <span className="brand">
                  <span className="brand-mark" /> Twokey
                </span>
                <nav>
                  <span className="on">
                    Inbox <em>{tape.length}</em>
                  </span>
                  <span>Needs you</span>
                  <span>Mandate</span>
                  <span>Audit</span>
                </nav>
                <small>Agents</small>
                <div className="w-agent">
                  <i style={{ background: 'var(--lime)' }} />
                  ap-agent<span>Twokey treasury</span>
                </div>
                <div className="w-agent">
                  <i style={{ background: '#c99bff' }} />
                  demo-agent<span>public demo</span>
                </div>
                <div className="w-treasury">
                  <span>Circle wallet on Arc</span>
                  <b>{s ? s.paid : '—'}</b>
                  <span>payments settled</span>
                </div>
                <div className="w-chain">
                  <i /> {s ? (s.audit.ok ? 'audit chain intact' : 'audit chain broken') : 'offline'}
                </div>
              </aside>
              <div className="w-main">
                <Inbox
                  per={2}
                  items={[
                    ...tape.map((r, i) => ({
                      id: `${i}`,
                      payee: r.payee ?? short(r.address),
                      amount: amt(r.amount),
                      lane: laneOf(r.status),
                      note: why(r),
                      meta: r.txHash ? (
                        <a href={explorerTx(r.txHash, r.demo ? TESTNET_EXPLORER : undefined)} target="_blank" rel="noreferrer">
                          {short(r.txHash)}
                          {r.seconds !== null ? ` · ${r.seconds.toFixed(1)} s` : ''}
                        </a>
                      ) : (
                        `${ist.format(r.at)} IST${r.demo ? ' · demo' : ''}`
                      ),
                    })),
                    // Illustrations for the lanes real traffic leaves empty most of the time, tagged as examples.
                    ...EXAMPLES.filter((e) => !tape.some((r) => laneOf(r.status) === e.lane)),
                  ]}
                />
              </div>
            </div>
            {tape.some((r) => r.txHash || r.status === 'BLOCKED') && (
              <div className="ticker" aria-hidden="true">
                <div>
                  {[0, 1].map((k) => (
                    <span key={k}>
                      {tape
                        .filter((r) => r.txHash || r.status === 'BLOCKED' || r.status === 'VOIDED')
                        .slice(0, 12)
                        .map((r, i) => (
                          <span key={i} className={`tk ${laneOf(r.status)}`}>
                            <b>{r.status === 'PAID' ? 'PAID' : r.status === 'BLOCKED' ? 'BLOCKED' : r.status === 'VOIDED' ? 'VOID' : r.status}</b> {r.payee ?? short(r.address)} {amt(r.amount)}
                            {r.txHash ? ` · ${short(r.txHash)}` : ' · nothing sent'}
                          </span>
                        ))}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="hero-facts">
            <div>
              <b>
                {s?.last ? s.last.seconds.toFixed(1) : '4.1'}
                <em>s</em>
              </b>
              request to final on Arc
            </div>
            <div>
              <b>
                20<em>/ 20</em>
              </b>
              paid exactly once in crash tests
            </div>
            <div>
              <b>{s ? s.paid : '—'}</b>
              payments settled through Circle Wallets
            </div>
          </div>
        </section>

        <section className="sec" id="seal">
          <div className="sec-h">
            <h2>You sign the terms, not a button.</h2>
            <p>Try it: hold to sign, then let the agent change a cent. The seal is a real SHA-256 of the terms, computed in your browser.</p>
          </div>
          <div className="seal-grid">
            <SignatureCard paidTx={s?.last?.txHash ?? null} paidSeconds={s?.last?.seconds ?? null} />
            <div className="card">
              <ol className="steps">
                <li>
                  <b>The agent writes the payment</b>
                  <p>Payee, address, amount, chain, memo and an expiry. It holds no wallet credentials; it can only ask.</p>
                </li>
                <li>
                  <b>Twokey seals the terms</b>
                  <p>One canonical form (RFC 8785), hashed with SHA-256. Your signature covers that seal.</p>
                </li>
                <li>
                  <b>The seal is checked again before money moves</b>
                  <p>Right before the Circle transfer, the terms are rebuilt from the payment as it will be sent. One cent different, and it is void.</p>
                </li>
              </ol>
              <pre className="terms-doc" style={{ marginTop: 16 }}>
                {'{ '}
                <span className="k">&quot;payee&quot;</span>: &quot;Brightline Media&quot;, <span className="k">&quot;amount&quot;</span>: &quot;0.750000&quot;,{'\n  '}
                <span className="k">&quot;address&quot;</span>: &quot;0x8569…9b92&quot;, <span className="k">&quot;network&quot;</span>: &quot;ARC&quot;, …{' }'}
                {'\n'}→ sha256 → the seal you countersign
              </pre>
            </div>
          </div>
        </section>

        <section className="sec" id="cards">
          <div className="cards-grid">
            <div className="pocket-stage" aria-hidden="true">
              <div className="acard k1">
                <div className="t">
                  <span>ap-agent</span>
                  <span className="mono">0.50 / tx</span>
                </div>
                <div className="num">•••• 4021</div>
                <div className="f">
                  <span>
                    <small>Today</small>1.00 of 1.50
                  </span>
                  <span>
                    <small>Pays in</small>USDC on Arc
                  </span>
                </div>
              </div>
              <div className="acard k2">
                <div className="t">
                  <span>ads-agent</span>
                  <span className="mono">2.00 / tx</span>
                </div>
                <div className="num">•••• 7730</div>
                <div className="f">
                  <span>
                    <small>Today</small>3.40 of 10.00
                  </span>
                  <span>
                    <small>Pays in</small>USDC on Arc
                  </span>
                </div>
              </div>
              <div className="acard k3">
                <div className="t">
                  <span>infra-agent</span>
                  <span className="mono">5.00 / tx</span>
                </div>
                <div className="num">•••• 1186</div>
                <div className="f">
                  <span>
                    <small>Today</small>0.00 of 25.00
                  </span>
                  <span>
                    <small>Pays in</small>USDC on Arc
                  </span>
                </div>
              </div>
              <div className="pocket">
                <div>
                  <span>Circle wallet on Arc</span>
                  <b>One treasury</b>
                </div>
                <span className="mono">one mandate per card</span>
              </div>
              <div className="ask-bubble">
                <span style={{ color: '#b26b00', fontWeight: 600 }}>ap-agent asks</span>
                <b>New merchant · 180.00</b>over the 0.50 cap
                <span className="btn btn-ink">Hold to countersign</span>
              </div>
            </div>
            <div className="cards-copy">
              <span className="st wait">Next</span>
              <h2 style={{ marginTop: 14 }}>Give every agent a card. Keep the second key.</h2>
              <p>
                One USDC treasury on Arc, a virtual card per agent, each with its own mandate. Every card authorization asks Twokey first: inside the
                mandate it clears in seconds, outside it waits for your signature. Today, payments run through Circle Wallets; cards come next.
              </p>
              <div className="next-list">
                <div>
                  <span>
                    Arc mainnet
                    <small>Real USDC, a 5 USDC hard cap per payment. The demo stays on testnet.</small>
                  </span>
                  <span className={`st ${cfg.network === 'ARC' ? 'paid' : 'run'}`}>{cfg.network === 'ARC' ? 'Live' : 'Building now'}</span>
                </div>
                <div>
                  <span>
                    x402 and Circle&apos;s Agent Stack
                    <small>Paid APIs follow the same mandate as invoices.</small>
                  </span>
                  <span className="st wait">Next</span>
                </div>
                <div>
                  <span>
                    Payees on any chain
                    <small>Settle from Arc to Base or Ethereum through CCTP and Gateway.</small>
                  </span>
                  <span className="st">Planned</span>
                </div>
                <div>
                  <span>
                    Team signatures
                    <small>Two of three approvers, a mandate per agent, Slack next to Telegram.</small>
                  </span>
                  <span className="st">Planned</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="circle">
          <div className="sec-h">
            <h2>Built on Arc and Circle Wallets.</h2>
            <p>USDC is both the money and the gas. A Circle developer-controlled wallet holds the treasury, and only Twokey&apos;s executor can move it.</p>
          </div>
          <div className="stack-grid">
            <div className="card ink">
              <h3>Arc</h3>
              <p>Settles every payment. With sub-second finality, a completed transfer is final by the time it reaches the audit log.</p>
            </div>
            <div className="card blue">
              <h3>USDC on Arc</h3>
              <p>
                The asset and the gas, read as one 6-decimal balance at <code>0x3600…0000</code>.
              </p>
            </div>
            <div className="card">
              <h3>Circle developer-controlled wallets</h3>
              <p>
                <code>createTransaction</code> with an idempotency key written down first; <code>getTransaction</code>, <code>getWalletTokenBalance</code> and{' '}
                <code>listTransactions</code> to reconcile.
              </p>
            </div>
            <div className="card">
              <h3>Circle webhooks</h3>
              <p>Verified by the executor, which holds the API key. The web app never sees Circle credentials.</p>
            </div>
          </div>
          <div className="card compare">
            <table>
              <thead>
                <tr>
                  <th>For an agent with a treasury</th>
                  <th>Wallet caps and allowlists</th>
                  <th>With Twokey on top</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Per-payment and daily caps</td>
                  <td data-label="Wallet caps and allowlists">
                    <span className="st paid">Yes</span>
                  </td>
                  <td data-label="With Twokey on top">
                    <span className="st paid">Yes</span>
                  </td>
                </tr>
                <tr>
                  <td>Only approved addresses</td>
                  <td data-label="Wallet caps and allowlists">
                    <span className="st paid">Yes</span>
                  </td>
                  <td data-label="With Twokey on top">
                    <span className="st paid">Each payee pinned to one</span>
                  </td>
                </tr>
                <tr>
                  <td>A payment over the cap</td>
                  <td data-label="Wallet caps and allowlists">
                    <span className="st">Rejected</span>
                  </td>
                  <td data-label="With Twokey on top">
                    <span className="st wait">Goes to you</span>
                  </td>
                </tr>
                <tr>
                  <td>Approval tied to amount, address, chain and expiry</td>
                  <td data-label="Wallet caps and allowlists">
                    <span className="st">No</span>
                  </td>
                  <td data-label="With Twokey on top">
                    <span className="st paid">Sealed with SHA-256</span>
                  </td>
                </tr>
                <tr>
                  <td>Agent changes the amount after approval</td>
                  <td data-label="Wallet caps and allowlists">
                    <span className="st">No check</span>
                  </td>
                  <td data-label="With Twokey on top">
                    <span className="st block">Void, nothing sent</span>
                  </td>
                </tr>
                <tr>
                  <td>Tamper-evident record with Arc tx hashes</td>
                  <td data-label="Wallet caps and allowlists">
                    <span className="st">No</span>
                  </td>
                  <td data-label="With Twokey on top">
                    <span className="st paid">Hash-chained, verifiable</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="sec" id="developers">
          <div className="sec-h">
            <h2>One tool for your agent.</h2>
            <p>An SDK call or an MCP tool. The answer is executed, pending_approval or blocked, and the agent never touches the wallet.</p>
          </div>
          <div className="dev">
            <pre className="code">
              <span className="k">const</span> {'{ agent }'} = createTwokey({'{ baseUrl, apiKey }'});{'\n\n'}
              <span className="k">const</span> r = <span className="k">await</span> agent.guard({'\n'}
              {'  { type: '}
              <span className="s">&apos;PAY&apos;</span>
              {',\n    payee: { payeeId: '}
              <span className="s">&apos;pay_oceanic&apos;</span>
              {' },\n    amount: '}
              <span className="s">&apos;0.25&apos;</span>
              {' },\n  { agentId: '}
              <span className="s">&apos;ap-agent&apos;</span>
              {',\n    idempotencyKey: '}
              <span className="s">&apos;invoice:INV-88213&apos;</span>
              {' },\n'});{'\n\n'}
              <span className="c">{'// r.outcome is executed, pending_approval or blocked'}</span>
            </pre>
            <div className="dev-cards">
              <div className="card">
                <h3>An MCP server</h3>
                <p>Three tools (pay, get a payment, read the mandate) over stdio or Streamable HTTP, for any MCP-capable agent.</p>
              </div>
              <div className="card">
                <h3>Countersign where you are</h3>
                <p>Hold to sign in the console, or tap Approve in Telegram. Telegram carries part of the seal; the server checks all of it.</p>
              </div>
              <div className="card">
                <h3>Exactly once, on the record</h3>
                <p>An idempotency key written before every Circle call, reconciliation after a crash, and a hash-chained log with each Arc tx hash.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="end">
          <div>
            <h2>Countersign a real payment on Arc.</h2>
            <p>Run the agent, sign one payment, change a cent on another. About a minute, no sign-up.</p>
          </div>
          <Link className="btn btn-lime" href="/demo">
            Open the live demo
          </Link>
        </section>

        <footer className="lp-foot">
          <div className="foot-row">
            <span>
              {cfg.network === 'ARC'
                ? 'Twokey on Arc mainnet. The live demo uses Arc Testnet: no real money moves there.'
                : 'Twokey on Arc. A testnet build: no real money moves.'}
            </span>
            <span style={{ display: 'flex', gap: 18 }}>
              <Link href="/demo">Live demo</Link>
              <Link href="/app">Console</Link>
              <a href="https://twokey.online">twokey.online</a>
            </span>
          </div>
          <div className="wordmark" aria-hidden="true">
            twokey
          </div>
        </footer>
      </div>
    </div>
  );
}
