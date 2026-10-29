/**
 * Adds a codebase walkthrough to the recorded video, as Circle's grant form asks: each Circle product shown in
 * the code (docs/screenshots, made by `pnpm code-shots`), with its file path and a voice-over, spliced in before
 * the audit scene. Run after scripts/record-video.ts.
 *
 *   pnpm exec tsx scripts/video-code-walkthrough.ts
 *
 * Writes out/video/twokey-on-arc-full.mp4 and copies it to apps/web/public/video/twokey-on-arc.mp4.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'out/video');
const SEG = join(OUT, 'code');
const W = 1600;
const H = 900;

for (const f of [join(ROOT, '.env.local'), join(homedir(), 'Desktop/twokey/.env.local')]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*(ELEVENLABS_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
}

const SLIDES: { img: string | null; title: string; path: string; say: string }[] = [
  {
    img: null,
    title: 'The code: only the executor talks to Circle',
    path: 'github.com/PrabalParihar/twokey-arc',
    say: "Now the code. Twokey has one rule for credentials: only the executor talks to Circle. The agent holds a Twokey key, and the web app refuses to start if Circle credentials are in its environment.",
  },
  {
    img: '01-circle-client-init.png',
    title: 'Circle Wallets · developer-controlled wallets client',
    path: 'packages/circle/src/client.ts',
    say: "The executor creates the Circle developer-controlled wallets client here, with the test or live keys depending on the network. On mainnet that takes two deliberate settings and separate live keys.",
  },
  {
    img: '02-wallets-on-arc-testnet.png',
    title: 'Circle Wallets · createWalletSet, createWallets on Arc · Faucet',
    path: 'scripts/circle-setup.ts',
    say: "The setup script creates a wallet set and E O A wallets on Arc with create wallet set and create wallets, and asks Circle's faucet for test USDC. Self-serve sandboxes get their own wallet the same way, from the testnet executor.",
  },
  {
    img: '03-usdc-transfer-on-arc.png',
    title: 'USDC on Arc · createTransaction',
    path: 'packages/circle/src/transfers.ts',
    say: "Every payment is a USDC transfer through create transaction. The idempotency key is written to our database before the call, so a crash or a timeout can never pay twice. Twenty out of twenty chaos runs paid exactly once.",
  },
  {
    img: '04-transaction-status.png',
    title: 'Circle Wallets · getTransaction to a final state',
    path: 'packages/core/src/executor.ts',
    say: "The executor polls get transaction until a terminal state, and records the Circle transaction id and the Arc transaction hash on the audit log.",
  },
  {
    img: '05-balance-one-view.png',
    title: 'USDC as gas on Arc · getWalletTokenBalance',
    path: 'packages/circle/src/balances.ts',
    say: "Balances come from get wallet token balance, using the six-decimal USDC view only. Arc pays gas in USDC, so the policy checks amount plus fee against this one balance, and keeps a reserve.",
  },
  {
    img: '06-guard-before-circle.png',
    title: 'The guard in front of Circle: re-classify, re-verify the seal',
    path: 'packages/core/src/executor.ts',
    say: "And this is the guard in front of Circle. Right before create transaction, the executor takes the org lock, reads a fresh balance, classifies the payment again and re-verifies the approval seal. If anything moved, nothing is sent.",
  },
  {
    img: '07-circle-webhooks.png',
    title: 'Circle webhooks v2 · signature verified',
    path: 'packages/circle/src/webhooks.ts',
    say: "Circle webhooks are stored by the web app and verified by the executor against Circle's notification signature, with polling as the fallback. The full map of every Circle call, with line numbers, is in the circle transcript file in the repo.",
  },
];

const seconds = (file: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
const ff = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** This ffmpeg has no drawtext, so titles are rendered as PNGs in Chrome and overlaid. */
async function png(browser: Browser, body: string, w: number, h: number, file: string) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(
    `<html><head><link href="https://fonts.googleapis.com/css2?family=Geist:wght@500;600&family=Geist+Mono&display=swap" rel="stylesheet"></head>` +
      `<body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;font-family:Geist,system-ui,sans-serif">${body}</body></html>`,
    { waitUntil: 'networkidle' },
  );
  await page.screenshot({ path: file });
  await page.close();
}

async function speak(text: string, file: string) {
  if (!process.env.ELEVENLABS_API_KEY) return execFileSync('say', ['-r', '172', '-o', file, text]);
  const voice = process.env.ELEVENLABS_VOICE_ID ?? 'iP95p4xoKVk53GoZ742B';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.42, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

async function main() {
  mkdirSync(SEG, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const parts: string[] = [];
  for (const [i, s] of SLIDES.entries()) {
    const id = createHash('sha256').update(s.say).digest('hex').slice(0, 12);
    const audio = join(OUT, 'audio', `code${i}-${id}.${process.env.ELEVENLABS_API_KEY ? 'mp3' : 'aiff'}`);
    mkdirSync(join(OUT, 'audio'), { recursive: true });
    if (!existsSync(audio)) await speak(s.say, audio);
    const dur = seconds(audio) + 0.8;
    const out = join(SEG, `slide${i}.mp4`);
    const head = join(SEG, `head${i}.png`);
    if (s.img) {
      await png(
        browser,
        `<div style="height:96px;background:#0f1012;color:#fff;padding:18px 48px;box-sizing:border-box"><div style="font:600 28px Geist">${html(s.title)}</div>` +
          `<div style="font:400 19px 'Geist Mono',monospace;color:#d6f45b;margin-top:6px">${html(s.path)}</div></div>`,
        W,
        96,
        head,
      );
      // Fit the code to the width; tall screenshots scroll slowly from top to bottom while the line is said.
      const body = H - 96 - 24;
      const vf =
        `[0:v]scale=${W - 96}:-2,pad=iw:max(ih\\,${body}):0:0:color=0xf7f7f8,` +
        `crop=${W - 96}:${body}:0:'(ih-${body})*min(1\\,max(0\\,(t-1.2)/(${dur.toFixed(2)}-2.4)))',` +
        `pad=${W}:${H}:48:${96 + 12}:color=0xf7f7f8[bg];[bg][2:v]overlay=0:0[v]`;
      ff(['-loop', '1', '-framerate', '30', '-t', dur.toFixed(2), '-i', join(ROOT, 'docs/screenshots', s.img), '-i', audio, '-loop', '1', '-i', head, '-filter_complex', vf, '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-af', 'apad', '-t', dur.toFixed(2), out]);
    } else {
      await png(
        browser,
        `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f7f7f8;color:#0f1012">` +
          `<div style="font:600 52px Geist;letter-spacing:-.02em">${html(s.title)}</div>` +
          `<div style="font:400 24px 'Geist Mono',monospace;color:#6c6f76;margin-top:18px">${html(s.path)}</div></div>`,
        W,
        H,
        head,
      );
      ff(['-loop', '1', '-framerate', '30', '-i', head, '-i', audio, '-filter_complex', '[0:v]format=yuv420p[v];[1:a]apad[a]', '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-t', dur.toFixed(2), out]);
    }
    parts.push(out);
    console.log(`slide ${i}: ${dur.toFixed(1)} s`);
  }
  await browser.close();

  // Splice before the audit scene: the product flow, the code, then the audit log, mainnet and the outro.
  // Caption times as they appear in the frames (written by record-video.ts), not the wall clock.
  const cues = JSON.parse(readFileSync(join(OUT, 'cues-video.json'), 'utf8')) as { key: string; atMs: number }[];
  const cut = (cues.find((c) => c.key === 'audit')!.atMs - 700) / 1000;
  const main = join(OUT, 'twokey-on-arc.mp4');
  const norm = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-ar', '48000', '-ac', '2'];
  const a = join(SEG, 'a.mp4');
  const b = join(SEG, 'b.mp4');
  ff(['-i', main, '-t', cut.toFixed(2), ...norm, a]);
  ff(['-ss', cut.toFixed(2), '-i', main, ...norm, b]);
  const list = [a, ...parts, b];
  const inputs = list.flatMap((f) => ['-i', f]);
  const concat = `${list.map((_, i) => `[${i}:v][${i}:a]`).join('')}concat=n=${list.length}:v=1:a=1[v][a]`;
  const full = join(OUT, 'twokey-on-arc-full.mp4');
  ff([...inputs, '-filter_complex', concat, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', full]);
  copyFileSync(full, join(ROOT, 'apps/web/public/video/twokey-on-arc.mp4'));
  console.log(`video: ${full} (${seconds(full).toFixed(1)} s)`);
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
