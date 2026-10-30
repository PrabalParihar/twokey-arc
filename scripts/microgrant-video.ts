/**
 * Video for the Arc Microgrants submission: Twokey Escrow built in Arc Studio, then real USDC moved through the
 * contract on Arc mainnet. Each scene is a screenshot from out/microgrant/shots framed with a caption (rendered in
 * Chrome, since this ffmpeg has no drawtext), a voice-over and a slow zoom.
 *
 *   pnpm exec tsx scripts/microgrant-video.ts
 *
 * Writes out/microgrant/twokey-escrow.mp4 and copies it to apps/web/public/video/twokey-escrow.mp4.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'out/microgrant');
const SHOTS = join(OUT, 'shots');
const SEG = join(OUT, 'seg');
const W = 1600;
const H = 900;

for (const f of [join(ROOT, '.env.local'), join(homedir(), 'Desktop/twokey/.env.local')]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*(ELEVENLABS_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
}

type Scene = { img: string | null; title: string; sub: string; say: string };

const SCENES: Scene[] = [
  {
    img: null,
    title: 'Twokey Escrow',
    sub: 'The two-key rule for AI agent payments · built in Arc Studio · live on Arc mainnet',
    say: 'This is Twokey Escrow: the two-key rule for AI agents that pay in USDC, built in Arc Studio and live on Arc mainnet.',
  },
  {
    img: '01-prompt.jpg',
    title: 'One prompt in Arc Studio',
    sub: 'studio.arc.io/app/79af613f-395f-4540-8682-9de524aac944',
    say: 'It started as one prompt. An allowed agent asks for a payment. Pinned payees within their limit are paid at once. Anything else waits in escrow until the owner countersigns the exact terms.',
  },
  {
    img: '02-review-tests.jpg',
    title: 'Contract, reviews and 116 tests, written in Arc Studio',
    sub: 'Two security reviews · static scan · unit, fuzz and invariant tests',
    say: 'Arc Studio wrote the Solidity contract, ran two security reviews and a static scan, and wrote a hundred and sixteen unit, fuzz and invariant tests, covering the limit boundaries, the twenty four hour window, pause and ownership.',
  },
  {
    img: '03-testnet.jpg',
    title: 'Testnet first, then a mainnet path signed from my own wallet',
    sub: 'Arc Testnet deploy · owner and agent views · Deploy card for MetaMask',
    say: 'It deployed to Arc Testnet first and built the owner and agent views. Then it made the app network aware and added a deploy card, so I could deploy the exact compiled bytecode to mainnet from my own wallet.',
  },
  {
    img: '04-code.jpg',
    title: 'TwokeyEscrow.sol',
    sub: 'Ownable2Step · Pausable · ReentrancyGuard · SafeERC20 over Arc USDC',
    say: 'The contract builds on OpenZeppelin, with two step ownership, pause, and a reentrancy guard, over Arc native USDC. An approval is sealed to a hash of the payee, amount, expiry and memo, so the owner signs exactly what gets paid.',
  },
  {
    img: '05-contract.jpg',
    title: 'Deployed on Arc mainnet',
    sub: '0x5D1333bA6E53Cb3A5Ff26Ff22cC1d4E9c8A49715 · explorer.arc.io',
    say: 'Here it is on Arc mainnet, deployed from MetaMask with that card. The deploy cost four cents of USDC in gas.',
  },
  {
    img: '06-owner.jpg',
    title: 'The live app, on mainnet',
    sub: 'fascinating-figolla-b5b7a2.netlify.app · deployed to Netlify from Arc Studio',
    say: 'The live app opens on mainnet. As the owner, I funded the escrow with thirty cents, allowed an agent with a twenty five cent daily cap, and pinned the Twokey treasury as a payee, with a five cent cap per payment.',
  },
  {
    img: '07-autopay.jpg',
    title: 'Request #1 · 0.05 USDC · auto-paid',
    sub: 'Within the payee cap and the agent cap, so the contract pays in the same transaction',
    say: 'Request one. The agent asks for five cents to the pinned payee. That is inside both limits, so the contract pays it in the same transaction.',
  },
  {
    img: '08-agent.jpg',
    title: 'Request #2 · 0.20 USDC · held for the owner',
    sub: 'Over the 0.05 per-payment cap, so it waits in escrow',
    say: 'Request two asks for twenty cents. That is over the payee cap, so the contract holds it in escrow, and the agent sees it waiting for the owner.',
  },
  {
    img: '10-approve.jpg',
    title: 'Countersigned by the owner · 0.20 USDC paid',
    sub: 'approve(id, termsHash) · the app recomputes the hash before Approve is enabled',
    say: 'The owner checks the terms. The app recomputes the hash before it enables Approve. The owner countersigns, and the twenty cents go to the payee. That is the second key on an agent payment.',
  },
  {
    img: '11-transfers.jpg',
    title: 'Real USDC through the contract',
    sub: 'Funded 0.30 in · 0.05 auto-paid · 0.20 countersigned',
    say: 'Every USDC movement is on the explorer. Thirty cents funded in, five cents auto paid, twenty cents countersigned.',
  },
  {
    img: '12-readme.jpg',
    title: 'Open source, pushed from Arc Studio',
    sub: 'github.com/PrabalParihar/twokey-escrow-studio',
    say: 'The code is public on GitHub, pushed from Arc Studio, with every mainnet transaction linked in the README. Twokey Escrow. Agents ask. You countersign.',
  },
];

const seconds = (file: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
const ff = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function frame(browser: Browser, s: Scene, file: string) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const shot = s.img ? `data:image/jpeg;base64,${readFileSync(join(SHOTS, s.img)).toString('base64')}` : null;
  const body = shot
    ? `<div style="height:100%;display:flex;flex-direction:column;align-items:center;padding:34px 0 0;box-sizing:border-box">` +
      `<img src="${shot}" style="max-width:1380px;max-height:672px;border-radius:14px;box-shadow:0 30px 70px -20px rgba(0,0,0,.7);border:1px solid #2a2c31">` +
      `<div style="margin-top:auto;width:100%;padding:0 110px 34px;box-sizing:border-box">` +
      `<div style="font:600 34px Geist;letter-spacing:-.02em;color:#fff">${html(s.title)}</div>` +
      `<div style="font:400 19px 'Geist Mono',monospace;color:#d6f45b;margin-top:8px">${html(s.sub)}</div></div></div>`
    : `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">` +
      `<div style="font:600 92px Geist;letter-spacing:-.04em;color:#fff">${html(s.title)}</div>` +
      `<div style="font:400 24px 'Geist Mono',monospace;color:#d6f45b;margin-top:22px">${html(s.sub)}</div></div>`;
  await page.setContent(
    `<html><head><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600&family=Geist+Mono&display=swap" rel="stylesheet"></head>` +
      `<body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#0f1012;font-family:Geist,system-ui,sans-serif">${body}</body></html>`,
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
  mkdirSync(join(OUT, 'audio'), { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const parts: string[] = [];
  for (const [i, s] of SCENES.entries()) {
    const id = createHash('sha256').update(s.say).digest('hex').slice(0, 12);
    const audio = join(OUT, 'audio', `s${i}-${id}.${process.env.ELEVENLABS_API_KEY ? 'mp3' : 'aiff'}`);
    if (!existsSync(audio)) await speak(s.say, audio);
    const dur = seconds(audio) + 0.9;
    const png = join(SEG, `frame${i}.png`);
    await frame(browser, s, png);
    const out = join(SEG, `scene${i}.mp4`);
    // A slow push-in keeps a still frame alive; zoompan needs an upscaled source to avoid jitter.
    const frames = Math.ceil(dur * 30);
    const vf = `scale=${W * 2}:${H * 2},zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=30,format=yuv420p`;
    ff(['-loop', '1', '-i', png, '-i', audio, '-filter_complex', `[0:v]${vf}[v];[1:a]apad[a]`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-t', dur.toFixed(2), out]);
    parts.push(out);
    console.log(`scene ${i}: ${dur.toFixed(1)} s`);
  }
  await browser.close();

  const inputs = parts.flatMap((f) => ['-i', f]);
  const concat = `${parts.map((_, i) => `[${i}:v][${i}:a]`).join('')}concat=n=${parts.length}:v=1:a=1[v][a]`;
  const full = join(OUT, 'twokey-escrow.mp4');
  ff([...inputs, '-filter_complex', concat, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', full]);
  copyFileSync(full, join(ROOT, 'apps/web/public/video/twokey-escrow.mp4'));
  ff(['-ss', '20', '-i', full, '-frames:v', '1', '-q:v', '3', join(ROOT, 'apps/web/public/video/twokey-escrow-poster.jpg')]);
  console.log(`video: ${full} (${seconds(full).toFixed(1)} s)`);
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
