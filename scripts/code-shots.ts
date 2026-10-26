// Renders the code screenshots the Circle grant form asks for (PRD §20.3), one per Circle product,
// straight from the source with real line numbers. Uses the installed Google Chrome. pnpm code-shots
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..');
const span = (file: string, start: string, lines: number) => {
  const all = readFileSync(resolve(ROOT, file), 'utf8').split('\n');
  const i = all.findIndex((l) => l.includes(start));
  if (i < 0) throw new Error(`anchor not found in ${file}: ${start}`);
  return { file, from: i + 1, code: all.slice(i, i + lines).join('\n') };
};

const SHOTS = [
  { name: '01-circle-client-init', title: 'Circle developer-controlled wallets: client init (executor and scripts only)', ...span('packages/circle/src/client.ts', 'import { initiateDeveloperControlledWalletsClient }', 19) },
  { name: '02-wallets-on-arc-testnet', title: 'Wallet set + EOA wallets on ARC-TESTNET, testnet USDC from the faucet', ...span('scripts/circle-setup.ts', 'if (!w) {', 38) },
  { name: '03-usdc-transfer-on-arc', title: 'USDC transfer on Arc: createTransaction with the written-ahead idempotency key and refId', ...span('packages/circle/src/transfers.ts', '/** USDC transfer on Arc', 18) },
  { name: '04-transaction-status', title: 'Transaction status and tx hash: getTransaction, polled to a terminal state', ...span('packages/core/src/executor.ts', '/** attempt.poll:', 52) },
  { name: '05-balance-one-view', title: 'One USDC balance: getWalletTokenBalance, ERC-20 view only, never summed with native', ...span('packages/circle/src/balances.ts', '/**', 25) },
  { name: '06-guard-before-circle', title: 'The guard in front of Circle: re-classify and re-verify the seal before createTransaction', ...span('packages/core/src/executor.ts', '    if (intent.approved) {', 46) },
  { name: '07-circle-webhooks', title: 'Circle webhooks v2: stored by web, signature verified by the executor', ...span('packages/circle/src/webhooks.ts', '/**', 32) },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A small TypeScript highlighter: comments, strings, keywords, numbers, calls. Enough for screenshots. */
const KW = /\b(import|from|export|const|let|async|await|return|if|else|for|of|new|throw|try|catch|function|type|interface|true|false|null|undefined|typeof)\b/g;
function highlight(line: string): string {
  const out: string[] = [];
  const re = /(\/\/.*$|\/\*.*?\*\/|\/\*\*.*$|^\s*\*.*$)|('(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*")/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    out.push(code(line.slice(last, m.index)));
    out.push(m[1] ? `<span class="c">${esc(m[0])}</span>` : `<span class="s">${esc(m[0])}</span>`);
    last = m.index! + m[0].length;
  }
  out.push(code(line.slice(last)));
  return out.join('');
}
const code = (t: string) =>
  esc(t)
    .replace(KW, '<span class="k">$1</span>')
    .replace(/\b(\d+(?:_\d+)*)\b/g, '<span class="n">$1</span>')
    .replace(/\b([a-zA-Z_]\w*)(?=\()/g, '<span class="f">$1</span>');

const html = (s: (typeof SHOTS)[number]) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400..600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
body{margin:0;background:#08090a;font-family:Inter,sans-serif;color:#f2f2f0;padding:28px}
.card{border:1px solid #2a2c30;border-radius:14px;background:#0e0f11;overflow:hidden;width:1320px}
.top{display:flex;justify-content:space-between;gap:24px;align-items:center;padding:12px 18px;border-bottom:1px solid #1f2124;font-size:13px;color:#9a9ea6}
.top b{color:#d9b46a;font-weight:500}.top code{font:400 12.5px 'IBM Plex Mono',monospace;color:#f2f2f0;white-space:nowrap}
.code{padding:14px 18px 16px 0;font:400 13px/1.62 'IBM Plex Mono',monospace;color:#d6d7d9}
.l{display:grid;grid-template-columns:58px 1fr;gap:16px}.l i{font-style:normal;text-align:right;color:#55595f;user-select:none}
.l span.t{white-space:pre-wrap;word-break:break-word}
.k{color:#d9b46a}.s{color:#9fd3a8}.c{color:#6b6f76;font-style:italic}.n{color:#b49cf0}.f{color:#8cc8ff}
</style></head><body><div class="card"><div class="top"><span><b>Twokey on Arc</b> · ${esc(s.title)}</span><code>${s.file} · L${s.from}–L${s.from + s.code.split('\n').length - 1}</code></div>
<div class="code">${s.code
  .split('\n')
  .map((l, k) => `<div class="l"><i>${s.from + k}</i><span class="t">${highlight(l) || ' '}</span></div>`)
  .join('')}</div></div></body></html>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 2 });
for (const s of SHOTS) {
  await page.setContent(html(s), { waitUntil: 'networkidle' });
  await page.locator('.card').screenshot({ path: resolve(ROOT, `docs/screenshots/${s.name}.png`) });
  console.log(`docs/screenshots/${s.name}.png  (${s.file} L${s.from})`);
}
await browser.close();
