import type { Metadata } from 'next';
import Link from 'next/link';
import './landing.css';
import { AgentDay, dayKind } from '@/components/agent-day';
import { SignatureCard } from '@/components/signature-card';
import { explorerTx } from '@/lib/explorer';
import { publicStats, recentReceipts, type PublicStats, type Receipt } from '@/lib/public-stats';
import { DEMO_ENABLED, demoCfg } from '@/lib/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Twokey on Arc: two signatures for every agent payment',
  description:
    'Your AI agent pays routine USDC bills on Arc by itself. Anything outside your mandate waits for your countersignature, sealed to the exact amount and payee. Built with Circle Wallets.',
};

const ist = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const short = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const amt = (a: string) => Number(a).toFixed(2);

function receiptLine(r: Receipt): { label: string; cls: string; why: string } {
  const who = r.demo ? 'a demo visitor' : 'the owner';
  switch (r.status) {
    case 'PAID':
      return r.approved ? { label: 'Paid', cls: 'paid', why: `countersigned by ${who}` } : { label: 'Paid', cls: 'paid', why: 'inside the mandate' };
    case 'QUEUED':
    case 'SUBMITTED':
      return { label: 'Sending', cls: 'run', why: r.approved ? `countersigned by ${who}` : 'inside the mandate' };
    case 'AWAITING_APPROVAL':
      return { label: 'Needs you', cls: 'wait', why: 'waiting for a countersignature' };
    case 'BLOCKED':
      return { label: 'Blocked', cls: 'block', why: `${r.ruleId} · nothing sent` };
    case 'VOIDED':
      return { label: 'Void', cls: 'void', why: 'changed after signing · nothing sent' };
    case 'REJECTED':
      return { label: 'Rejected', cls: 'block', why: `refused by ${who}` };
    default:
      return { label: r.status.toLowerCase(), cls: '', why: r.ruleId };
  }
}

async function load(): Promise<{ s: PublicStats | null; tape: Receipt[] }> {
  try {
    // With the public demo on, visitors' runs count too: they are real Arc Testnet decisions.
    const [own, demoStats, ownTape, demoTape] = await Promise.all([
      publicStats(),
      DEMO_ENABLED ? publicStats(demoCfg.orgId) : null,
      recentReceipts(undefined, 30),
      DEMO_ENABLED ? recentReceipts(demoCfg.orgId, 30) : [],
    ]);
    const s = demoStats ? { ...own, paid: own.paid + demoStats.paid, last: own.last ?? demoStats.last } : own;
    const tape = [...ownTape, ...demoTape].sort((a, b) => b.at.getTime() - a.at.getTime());
    return { s, tape };
  } catch {
    return { s: null, tape: [] };
  }
}

export default async function Landing() {
  const { s, tape } = await load();
  const now = new Date();
  // A quiet testnet afternoon shouldn't show an empty day: end the window at the latest decision then.
  const dayEnd = tape[0] && now.getTime() - tape[0].at.getTime() > 7 * 3_600_000 ? new Date(tape[0].at.getTime() + 600_000) : now;

  return (
    <div className="lp">
      <div className="wrap">
        <nav className="lp-nav" aria-label="Main">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true" /> Twokey
          </Link>
          <div className="nav lp-links">
            <a className="nav-i" href="#live">
              Live on Arc
            </a>
            <a className="nav-i" href="#seal">
              The seal
            </a>
            <a className="nav-i" href="#circle">
              Circle Wallets
            </a>
            <a className="nav-i" href="#developers">
              Developers
            </a>
          </div>
          <div className="lp-cta">
            <Link className="btn btn-dark btn-sm lp-console" href="/app">
              Console
            </Link>
            <Link className="btn btn-ink btn-sm" href="/demo">
              Countersign a live payment
            </Link>
          </div>
        </nav>

        <section className="hero">
          <div className="hero-copy">
            <span className="pill">
              <span className="live-dot" /> Live on Arc Testnet{s ? ` · ${s.paid} payments settled` : ''}
            </span>
            <h1>Every payment your agent writes needs two signatures.</h1>
            <p className="lede">
              Routine bills already carry yours: you signed them once, in your mandate. Anything else waits for your countersignature, sealed to the
              exact amount and payee. USDC on Arc, through Circle Wallets.
            </p>
            <ul className="lanes">
              <li>
                <span className="st paid">Paid</span>Known payee, under your caps. Final on Arc in seconds.
              </li>
              <li>
                <span className="st wait">Needs you</span>New payee or over a cap. Nothing moves until you sign.
              </li>
              <li>
                <span className="st void">Void</span>Changed after you signed, or a known payee at a new address.
              </li>
            </ul>
            <div className="hero-ctas">
              <Link className="btn btn-ink" href="/demo">
                Countersign a live payment
              </Link>
              <a className="btn" href="#seal">
                How the seal works
              </a>
            </div>
          </div>
          <div className="window" aria-label="Product preview">
            <SignatureCard paidTx={s?.last?.txHash ?? null} paidSeconds={s?.last?.seconds ?? null} />
            <div className="window-row">
              <div className="mini lime">
                <small>Request to final on Arc</small>
                <b>
                  {s?.last ? s.last.seconds.toFixed(1) : '4.1'}
                  <em>s</em>
                </b>
              </div>
              <div className="mini">
                <small>Paid exactly once, crash tests</small>
                <b>
                  20<em>/ 20</em>
                </b>
              </div>
              <div className="mini">
                <small>Audit chain</small>
                <b>
                  {s ? s.audit.length : '—'}
                  <em>{s?.audit.ok === false ? 'broken' : 'intact'}</em>
                </b>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="live">
          <div className="sec-h">
            <h2>The receipts are real.</h2>
            <p>Every decision on Twokey&apos;s treasury and the live demo, as it happened on Arc Testnet. Paid lines link to the Arc explorer.</p>
          </div>
          <div className="live-grid">
            <div className="card">
              <div className="card-h">
                <h3>The agents&apos; day</h3>
                <span>last eight hours, IST</span>
              </div>
              <AgentDay
                now={dayEnd}
                items={tape.map((r, i) => ({
                  id: `${i}`,
                  at: r.at,
                  payee: r.payee ?? short(r.address),
                  amount: amt(r.amount),
                  kind: dayKind(r.status, r.approved),
                  sub: receiptLine(r).label,
                }))}
              />
            </div>
            <div className="card">
              <div className="card-h">
                <h3>Latest decisions</h3>
                <span>{s ? (s.audit.ok ? `chain intact · ${s.audit.length}` : 'chain broken') : 'offline'}</span>
              </div>
              <ul className="rows">
                {tape.length === 0 && <li className="empty">No receipts yet.</li>}
                {tape.slice(0, 6).map((r, i) => {
                  const l = receiptLine(r);
                  const name = r.payee ?? short(r.address);
                  return (
                    <li className="row" key={i}>
                      <span className="monogram">{name.replace(/^"/, '').slice(0, 1).toUpperCase()}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="t">{name}</span>
                        <span className="m">
                          {ist.format(r.at)} · {l.why}
                          {r.txHash && (
                            <>
                              {' · '}
                              <a href={explorerTx(r.txHash)} target="_blank" rel="noreferrer">
                                {short(r.txHash)}
                              </a>
                            </>
                          )}
                        </span>
                      </span>
                      <span className="a">{amt(r.amount)}</span>
                      <span className={`st ${l.cls}`}>{l.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>

        <section className="sec" id="seal">
          <div className="sec-h">
            <h2>You sign the terms, not a button.</h2>
            <p>An approval in Twokey is a signature over the payment itself, checked again at the last moment before any money moves.</p>
          </div>
          <div className="seal-grid">
            <ol className="steps">
              <li className="card">
                <b>The agent writes the payment</b>
                <p>Payee, address, amount, chain, memo and an expiry. It holds no wallet credentials; it can only ask.</p>
              </li>
              <li className="card">
                <b>Twokey seals the terms</b>
                <p>The terms are written in one canonical form (RFC 8785) and hashed with SHA-256. Your countersignature covers that seal.</p>
              </li>
              <li className="card">
                <b>The seal is checked again before money moves</b>
                <p>Right before the Circle transfer, the terms are rebuilt from the payment as it will be sent. One cent different, and the approval is void.</p>
              </li>
            </ol>
            <div className="terms-doc focus" aria-label="Example of sealed terms">
              <pre>
                {'{\n'}
                {'  '}
                <span className="k">&quot;payee&quot;</span>: &quot;Brightline Media&quot;,{'\n'}
                {'  '}
                <span className="k">&quot;address&quot;</span>: &quot;0x8569…9b92&quot;,{'\n'}
                {'  '}
                <span className="k">&quot;amount&quot;</span>: &quot;0.750000&quot;,{'\n'}
                {'  '}
                <span className="k">&quot;token&quot;</span>: &quot;USDC 0x3600…0000&quot;,{'\n'}
                {'  '}
                <span className="k">&quot;network&quot;</span>: &quot;ARC-TESTNET&quot;,{'\n'}
                {'  '}
                <span className="k">&quot;expires_at&quot;</span>: &quot;2026-10-27T16:36:00Z&quot;{'\n'}
                {'}'}
              </pre>
              <div className="f-seal">
                <span>sha256(canonical terms)</span>
                <b>the seal you countersign</b>
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
            <div className="card lime">
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
                  <td>
                    <span className="st paid">Yes</span>
                  </td>
                  <td>
                    <span className="st paid">Yes</span>
                  </td>
                </tr>
                <tr>
                  <td>Only approved addresses</td>
                  <td>
                    <span className="st paid">Yes</span>
                  </td>
                  <td>
                    <span className="st paid">Each payee pinned to one</span>
                  </td>
                </tr>
                <tr>
                  <td>A payment over the cap</td>
                  <td>
                    <span className="st">Rejected</span>
                  </td>
                  <td>
                    <span className="st paid">Goes to you</span>
                  </td>
                </tr>
                <tr>
                  <td>Approval tied to amount, address, chain and expiry</td>
                  <td>
                    <span className="st">No</span>
                  </td>
                  <td>
                    <span className="st paid">Sealed with SHA-256</span>
                  </td>
                </tr>
                <tr>
                  <td>Agent changes the amount after approval</td>
                  <td>
                    <span className="st">No check</span>
                  </td>
                  <td>
                    <span className="st paid">Void, nothing sent</span>
                  </td>
                </tr>
                <tr>
                  <td>Tamper-evident record with Arc tx hashes</td>
                  <td>
                    <span className="st">No</span>
                  </td>
                  <td>
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
                <h3>Arc mainnet next</h3>
                <p>The same code runs on Arc mainnet by configuration, with tighter limits. Payees on other chains, via CCTP and Gateway, come after.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="end">
          <div>
            <h2>Countersign a real payment on Arc Testnet.</h2>
            <p>Run the agent, sign one payment, change a cent on another. About a minute, no sign-up.</p>
          </div>
          <Link className="btn btn-ink" href="/demo">
            Open the live demo
          </Link>
        </section>

        <footer className="lp-foot">
          <span>Twokey on Arc. A testnet build: no real money moves.</span>
          <a href="https://twokey.online">twokey.online</a>
        </footer>
      </div>
    </div>
  );
}
