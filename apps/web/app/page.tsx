import type { Metadata } from 'next';
import Link from 'next/link';
import './landing.css';
import { Cheque } from '@/components/cheque';
import { Guilloche } from '@/components/guilloche';
import { explorerTx } from '@/lib/explorer';
import { paperFonts } from '@/lib/fonts';
import { DEMO_ENABLED, demoCfg } from '@/lib/server';
import { publicStats, recentReceipts, type PublicStats, type Receipt } from '@/lib/public-stats';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Twokey on Arc: two signatures for every agent payment',
  description:
    'Your AI agent pays routine USDC bills on Arc by itself. Anything outside your mandate waits for your countersignature, sealed to the exact amount and payee. Built with Circle Wallets.',
};

const ist = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const short = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const amt = (a: string) => a.replace(/0{1,4}$/, '');

function receiptLine(r: Receipt): { label: string; cls: string; why: string } {
  switch (r.status) {
    case 'PAID':
      return r.approved ? { label: 'PAID', cls: 'st-paid', why: r.demo ? 'countersigned by a demo visitor' : 'countersigned by the owner' } : { label: 'PAID', cls: 'st-paid', why: `inside the mandate · ${r.ruleId}` };
    case 'AWAITING_APPROVAL':
      return { label: 'NEEDS YOU', cls: 'st-wait', why: `waiting for a countersignature · ${r.ruleId}` };
    case 'BLOCKED':
      return { label: 'BLOCKED', cls: 'st-block', why: `${r.ruleId} · nothing sent` };
    case 'VOIDED':
      return { label: 'VOID', cls: 'st-void', why: 'changed after signing · nothing sent' };
    case 'REJECTED':
      return { label: 'REJECTED', cls: 'st-void', why: r.demo ? 'refused by a demo visitor' : 'refused by the owner' };
    default:
      return { label: r.status, cls: '', why: r.ruleId };
  }
}

async function load(): Promise<{ s: PublicStats | null; tape: Receipt[] }> {
  try {
    // With the public demo on, visitors' runs print here too: they are real Arc Testnet decisions.
    const [own, demoStats, ownTape, demoTape] = await Promise.all([
      publicStats(),
      DEMO_ENABLED ? publicStats(demoCfg.orgId) : null,
      recentReceipts(undefined, 6),
      DEMO_ENABLED ? recentReceipts(demoCfg.orgId, 6) : [],
    ]);
    const s = demoStats ? { ...own, paid: own.paid + demoStats.paid, last: own.last ?? demoStats.last } : own;
    const tape = [...ownTape, ...demoTape].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 6);
    return { s, tape };
  } catch {
    return { s: null, tape: [] };
  }
}

export default async function Landing() {
  const { s, tape } = await load();
  return (
    <div className={`lp ${paperFonts}`}>
      <Guilloche className="bg" viewBox="0 0 1440 1100" cx={1320} cy={1020} R={430} r={89} d={150} layers={4} color="#b9cbbf" width={0.6} />
      <div className="wrap">
        <nav className="lp-nav" aria-label="Main">
          <Link href="/" className="lp-brand">
            Twokey <span>on Arc</span>
          </Link>
          <div className="lp-links">
            <a href="#live">Live on Arc</a>
            <a href="#seal">The seal</a>
            <a href="#circle">Circle Wallets</a>
            <a href="#developers">Developers</a>
          </div>
          <div className="lp-cta">
            <Link className="lp-btn plain" href="/app">
              Console
            </Link>
            <Link className="lp-btn dark" href="/demo">
              Countersign a live payment
            </Link>
          </div>
        </nav>

        <section className="hero">
          <div>
            <h1>Every payment your agent writes needs two signatures.</h1>
            <p className="lede">
              Routine bills already carry yours: you signed them once, in your mandate. Anything else waits for your countersignature, sealed to the
              exact amount and payee. USDC on Arc, through Circle Wallets.
            </p>
            <ul className="lanes">
              <li>
                <span className="mark paid">PAID</span>Known payee, under your caps. Final on Arc in seconds.
              </li>
              <li>
                <span className="mark wait">NEEDS YOU</span>New payee or over a cap. Nothing moves until you sign.
              </li>
              <li>
                <span className="mark void">VOID</span>Changed after you signed, or a known payee at a new address.
              </li>
            </ul>
          </div>
          <Cheque
            paidTx={s?.last?.txHash ?? null}
            paidSeconds={s?.last?.seconds ?? null}
            rosette={<Guilloche viewBox="0 0 320 320" cx={160} cy={160} R={120} r={37} d={60} layers={5} color="#8fb0a0" width={0.5} />}
          />
        </section>

        <section className="sec tape-sec" id="live">
          <div>
            <h2>The receipts are real.</h2>
            <p className="lead">
              This tape prints the latest decisions on Arc Testnet, from Twokey&apos;s own treasury and from visitors running the live demo. Every
              paid line links to its transaction on the Arc explorer.
            </p>
            <div className="tape-facts">
              <div>
                <b>{s?.last ? `${s.last.seconds.toFixed(1)} s` : '—'}</b>
                <span>from the agent&apos;s request to a final transfer on Arc, for the last payment inside the mandate</span>
              </div>
              <div>
                <b>{s ? s.paid : '—'}</b>
                <span>payments settled through a Circle developer-controlled wallet</span>
              </div>
              <div>
                <b>20 of 20</b>
                <span>paid exactly once when the payment process was killed mid-flight or Circle timed out (testnet, Oct 27)</span>
              </div>
            </div>
          </div>
          <div aria-label="Latest decisions on Arc Testnet">
            <div className="printer-head">
              <span>
                <i />
                twokey · arc testnet 5042002
              </span>
              <span>{s ? (s.audit.ok ? `chain intact · ${s.audit.length}` : 'chain broken') : 'offline'}</span>
            </div>
            <div className="printer-slot" />
            <div className="tape">
              {tape.length === 0 && <div className="rc">No receipts yet.</div>}
              {tape.map((r, i) => {
                const l = receiptLine(r);
                return (
                  <div className="rc" key={i}>
                    <div className="rc-row">
                      <span>
                        {ist.format(r.at)} {(r.payee ?? short(r.address)).toUpperCase()}
                      </span>
                      <span>{amt(r.amount)}</span>
                    </div>
                    <div className="rc-row sub">
                      <span>{l.why}</span>
                      <span className={`rc-st ${l.cls}`}>{l.label}</span>
                    </div>
                    {r.txHash && (
                      <div className="sub">
                        <a href={explorerTx(r.txHash)} target="_blank" rel="noreferrer">
                          arc tx {short(r.txHash)}
                        </a>
                        {r.seconds !== null && ` · ${r.seconds.toFixed(1)} s`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="sec" id="seal">
          <h2>You sign the terms, not a button.</h2>
          <div className="seal-sec">
            <ol className="steps">
              <li>
                <div>
                  <b>The agent writes the payment</b>
                  <p>Payee, address, amount, chain, memo and an expiry. It holds no wallet credentials; it can only ask.</p>
                </div>
              </li>
              <li>
                <div>
                  <b>Twokey seals the terms</b>
                  <p>The terms are written in one canonical form (RFC 8785) and hashed with SHA-256. Your countersignature covers that seal.</p>
                </div>
              </li>
              <li>
                <div>
                  <b>The seal is checked again before any money moves</b>
                  <p>
                    Right before the Circle transfer, the terms are rebuilt from the payment as it will be sent. If one cent or one character
                    changed, the approval is void and nothing is sent.
                  </p>
                </div>
              </li>
            </ol>
            <div className="terms-doc" aria-label="Example of sealed terms">
              {'{\n'}
              {'  '}<span className="k">&quot;payee&quot;</span>: &quot;Brightline Media&quot;,{'\n'}
              {'  '}<span className="k">&quot;address&quot;</span>: &quot;0x8569…9b92&quot;,{'\n'}
              {'  '}<span className="k">&quot;amount&quot;</span>: &quot;0.750000&quot;,{'\n'}
              {'  '}<span className="k">&quot;token&quot;</span>: &quot;USDC 0x3600…0000&quot;,{'\n'}
              {'  '}<span className="k">&quot;network&quot;</span>: &quot;ARC-TESTNET&quot;,{'\n'}
              {'  '}<span className="k">&quot;expires_at&quot;</span>: &quot;2026-10-27T16:36:00Z&quot;{'\n'}
              {'}\n'}
              {'\n'}
              <span className="h">sha256(canonical terms) → the seal you countersign</span>
            </div>
          </div>
        </section>

        <section className="sec" id="circle">
          <h2>Built on Arc and Circle Wallets.</h2>
          <p className="lead">USDC is both the money and the gas. A Circle developer-controlled wallet holds the treasury, and only Twokey&apos;s executor can move it.</p>
          <table className="ledger">
            <tbody>
              <tr>
                <td>Arc</td>
                <td>Settles every payment. With sub-second finality, a completed transfer is final by the time it reaches the audit log.</td>
              </tr>
              <tr>
                <td>USDC on Arc</td>
                <td>
                  The asset and the gas, read as one 6-decimal balance at <code>0x3600…0000</code>.
                </td>
              </tr>
              <tr>
                <td>Circle developer-controlled wallets</td>
                <td>
                  Transfers with <code>createTransaction</code> and an idempotency key written down first; status with <code>getTransaction</code>;
                  balance with <code>getWalletTokenBalance</code>; reconciliation with <code>listTransactions</code>.
                </td>
              </tr>
              <tr>
                <td>Circle webhooks</td>
                <td>Verified by the executor, which holds the API key. The web app never sees Circle credentials.</td>
              </tr>
            </tbody>
          </table>

          <table className="ledger">
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
                <td className="y">Yes</td>
                <td className="y">Yes</td>
              </tr>
              <tr>
                <td>Only approved addresses</td>
                <td className="y">Yes</td>
                <td className="y">Yes, each payee pinned to one</td>
              </tr>
              <tr>
                <td>A payment over the cap</td>
                <td className="n">Rejected</td>
                <td className="y">Goes to you</td>
              </tr>
              <tr>
                <td>Approval tied to amount, address, chain and expiry</td>
                <td className="n">No</td>
                <td className="y">Sealed with SHA-256</td>
              </tr>
              <tr>
                <td>Agent changes the amount after approval</td>
                <td className="n">No check</td>
                <td className="y">Void, nothing sent</td>
              </tr>
              <tr>
                <td>Tamper-evident record with Arc tx hashes</td>
                <td className="n">No</td>
                <td className="y">Hash-chained, verifiable</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="sec" id="developers">
          <h2>One tool for your agent.</h2>
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
            <dl>
              <div>
                <dt>An MCP server</dt>
                <dd>Three tools (pay, get a payment, read the mandate) over stdio or Streamable HTTP, for any MCP-capable agent.</dd>
              </div>
              <div>
                <dt>Countersign where you are</dt>
                <dd>Hold to approve in the console, or tap Approve in Telegram. Telegram carries part of the seal; the server checks all of it.</dd>
              </div>
              <div>
                <dt>Arc mainnet next</dt>
                <dd>The same code runs on Arc mainnet by configuration, with tighter limits. Payees on other chains, via CCTP and Gateway, come after.</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="end">
          <div>
            <h2>Countersign a real payment on Arc Testnet.</h2>
            <p>Run the agent, sign one payment, change a cent on another. About a minute, no sign-up.</p>
          </div>
          <Link className="lp-btn dark" href="/demo">
            Open the live demo
          </Link>
        </section>

        <footer className="lp-foot">
          <span>Twokey on Arc. A testnet build: no real money moves.</span>
          <span>
            <a href="https://twokey.online">twokey.online</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
