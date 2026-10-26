// Writes docs/CIRCLE_TRANSCRIPT.md with real file paths and line numbers, found by searching the code for
// anchors, so the transcript can't drift from the code. Re-run after any change: pnpm transcript
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const REPO = 'https://github.com/PrabalParihar/twokey-arc/blob/main';

/** First line matching `pattern`, through the end of its block (the next line closing at the same indent). */
function locate(file: string, pattern: string, whole = true): { file: string; from: number; to: number } {
  const lines = readFileSync(resolve(ROOT, file), 'utf8').split('\n');
  const i = lines.findIndex((l) => l.includes(pattern));
  if (i < 0) throw new Error(`anchor not found: ${file} :: ${pattern}`);
  if (!whole) return { file, from: i + 1, to: i + 1 };
  const indent = /^\s*/.exec(lines[i]!)![0].length;
  let j = i;
  if (/[{(\[]\s*$/.test(lines[i]!)) {
    for (j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (l.trim() && /^\s*/.exec(l)![0].length === indent && /^\s*[})\]]/.test(l)) {
        // A multi-line signature closes with "): T {"; keep going to the body's closing brace.
        if (!/\{\s*$/.test(l)) break;
      }
    }
  }
  return { file, from: i + 1, to: j + 1 };
}

const ref = (r: { file: string; from: number; to: number }, label?: string) => {
  const range = r.from === r.to ? `L${r.from}` : `L${r.from}–L${r.to}`;
  return `[\`${r.file}\` ${range}](${REPO}/${r.file}#L${r.from}${r.to !== r.from ? `-L${r.to}` : ''})${label ? ` (${label})` : ''}`;
};

const rows: { product: string; what: string; where: string[] }[] = [
  {
    product: '**Arc Testnet** (chain `5042002`)',
    what: 'The settlement rail for every payment. Gas is paid in USDC, and with sub-second finality a `COMPLETE` transfer is final, which the audit log records.',
    where: [
      ref(locate('packages/circle/src/config.ts', 'export const ARC_TESTNET'), 'chain id, `ARC-TESTNET`, RPC, explorer'),
      ref(locate('packages/circle/src/config.ts', 'export function arcNetwork'), 'testnet-only guard'),
      ref(locate('apps/web/lib/explorer.ts', 'export const explorerTx', false), 'explorer links'),
    ],
  },
  {
    product: '**USDC on Arc** (`0x3600…0000`, 6-dp ERC-20 view)',
    what: 'The asset being paid and also the gas token. Twokey reads one balance and never adds the 18-dp native view to the 6-dp ERC-20 view.',
    where: [
      ref(locate('packages/money/src/usdc.ts', 'export const USDC_ARC_ADDRESS', false), 'address'),
      ref(locate('packages/money/src/usdc.ts', 'export function parseUsdc'), 'exact 6-dp parsing, no floats'),
      ref(locate('packages/circle/src/balances.ts', 'export function pickUsdcBalance'), 'one balance, one view'),
      ref(locate('packages/circle/src/units.ts', 'export function decimalToUsdc6'), 'Circle fee → 6 dp, rounded up'),
    ],
  },
  {
    product: '**Circle Wallets: developer-controlled wallets** (`@circle-fin/developer-controlled-wallets` 10.8.1)',
    what: 'The treasury wallet the agent pays from. The wallet set and wallets are created on `ARC-TESTNET`. Transfers go through `createTransaction` with an idempotency key written ahead, status through `getTransaction`, balance through `getWalletTokenBalance`, and reconciliation through `listTransactions`. Only the executor holds the credentials.',
    where: [
      ref(locate('packages/circle/src/client.ts', 'export function circleClientFromEnv'), '`initiateDeveloperControlledWalletsClient`'),
      ref(locate('scripts/circle-setup.ts', 'const set = await circle.createWalletSet', false), '`createWalletSet`'),
      ref(locate('scripts/circle-setup.ts', 'const created = await circle.createWallets'), "`createWallets` on `ARC-TESTNET`, EOA"),
      ref(locate('packages/circle/src/transfers.ts', 'export async function createUsdcTransfer'), '`createTransaction` with USDC, `idempotencyKey`, `refId`'),
      ref(locate('packages/circle/src/transfers.ts', 'export async function getTransfer'), '`getTransaction`'),
      ref(locate('packages/circle/src/transfers.ts', 'export async function listTransfers'), '`listTransactions` for reconcile'),
      ref(locate('packages/circle/src/transfers.ts', 'export async function estimateUsdcTransferFee'), '`estimateTransferFee`'),
      ref(locate('packages/circle/src/balances.ts', 'export async function getUsdcBalance'), '`getWalletTokenBalance`'),
      ref(locate('apps/executor/src/circle-port.ts', 'export function circlePort'), 'the executor-only adapter'),
    ],
  },
  {
    product: '**The guard in front of Circle**',
    what: 'Before any `createTransaction` runs, the executor takes the org lock, reads a fresh balance from Circle, classifies the payment a third time, rebuilds and re-verifies the approval seal, and commits the attempt row with its idempotency key. Only then does it call Circle.',
    where: [
      ref(locate('packages/core/src/executor.ts', 'export async function prepareExecution'), 're-classify + seal check + write-ahead'),
      ref(locate('packages/core/src/executor.ts', 'export async function submitAttempt'), 'the Circle call site'),
      ref(locate('packages/core/src/executor.ts', 'export async function pollAttempt'), 'poll to `COMPLETE` + tx hash'),
      ref(locate('packages/core/src/executor.ts', 'export async function reconcileAttempt'), 'same-key reconcile'),
      ref(locate('apps/executor/src/jobs/execute-payment.ts', 'export async function handleExecutePayment'), 'pg-boss job'),
      ref(locate('apps/executor/src/jobs/poll-attempt.ts', 'export async function handlePollAttempt'), 'pg-boss job'),
    ],
  },
  {
    product: '**Circle Faucet / testnet tokens**',
    what: 'Funds the demo treasury with testnet USDC.',
    where: [ref(locate('scripts/circle-setup.ts', 'await circle.requestTestnetTokens', false), '`requestTestnetTokens`'), 'or https://faucet.circle.com'],
  },
  {
    product: '**Circle webhooks (v2)**',
    what: 'Push updates on transaction state. Web stores the raw event (deduplicated on `notificationId`). The executor, which holds the API key, verifies `X-Circle-Signature` with the key from `getNotificationSignature` before acting. Polling stays as the fallback.',
    where: [
      ref(locate('apps/web/app/api/circle/webhook/route.ts', 'export function POST'), 'receive + dedupe'),
      ref(locate('packages/circle/src/webhooks.ts', 'export async function verifyCircleSignature'), 'ECDSA P-256 / SHA-256'),
      ref(locate('apps/executor/src/jobs/process-webhook.ts', 'export async function handleWebhook'), 'verify, then act'),
    ],
  },
  {
    product: 'CCTP V2 via App Kit / Bridge Kit',
    what: '**Planned (M2), not in this build.** It will pay a payee on another chain under the same mandate, with the destination chain and address sealed into the approval.',
    where: ['`packages/circle/src/bridge.ts` (M2)'],
  },
  {
    product: 'Gateway',
    what: '**Planned (M2), not in this build.** Instant cross-chain payouts from a unified USDC balance.',
    where: ['`packages/circle/src/gateway.ts` (M2)'],
  },
];

const out = `# Twokey on Arc: Circle integration transcript

Twokey is an approval layer for AI agents that move USDC. In this demo an accounts-payable agent requests payments. Twokey's policy code decides what happens, and only Twokey's executor can move money through Circle.

| Circle product | What it does in Twokey | Where in the code |
|---|---|---|
${rows.map((r) => `| ${r.product} | ${r.what} | ${r.where.join('<br>')} |`).join('\n')}

**Flow in the video**
1. An in-mandate payment goes through \`createTransaction\` on Arc and reaches \`COMPLETE\` with a tx hash.
2. An out-of-mandate payment gets a sealed approval, and only after that a \`createTransaction\`.
3. A pinned-payee violation is blocked before any Circle call.
4. Drift after approval voids it, and no Circle call is made.
5. The audit chain is verified, with Circle tx ids and Arc tx hashes.

_Generated by \`pnpm transcript\` from the code at the commit it ships with. Line numbers are found by searching for each anchor, not typed by hand._
`;
writeFileSync(resolve(ROOT, 'docs/CIRCLE_TRANSCRIPT.md'), out);
console.log('docs/CIRCLE_TRANSCRIPT.md written');
