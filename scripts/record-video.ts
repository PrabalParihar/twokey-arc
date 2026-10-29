/// <reference lib="dom" />
/**
 * Records the Twokey on Arc video: the landing, a full sandbox sign-up on Arc Testnet (wallet, mandate,
 * the agent's badge, a payment inside the mandate, one outside it that waits for a hold), the audit log,
 * and the mainnet treasury on the Arc explorer. Captions on screen, a voice-over muxed in by ffmpeg.
 *
 *   BASE=http://localhost:3200 pnpm exec tsx scripts/record-video.ts
 *
 * BASE is a running web app with SANDBOX_SIGNUPS=true and a testnet executor with SANDBOX_HOST=true.
 * Voice: ELEVENLABS_API_KEY from the environment or ~/Desktop/twokey/.env.local (never printed), else macOS `say`.
 * Writes apps/web/public/video/twokey-on-arc.mp4.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'out/video');
const AUDIO = join(OUT, 'audio');
const BASE = process.env.BASE ?? 'http://localhost:3200';
const SITE = 'https://twokey.si';
const MAINNET_TREASURY = '0x6d57604cbefd802a0d74ae5bb0461891711adbf2';
const OVERLAY_CSS =
  '#rec-cur{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(15,16,18,.55);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;transition:transform .12s}' +
  'nextjs-portal{display:none!important}' +
  '#rec-cur.down{transform:scale(.7);background:rgba(214,244,91,.9)}' +
  '#rec-cap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483646;max-width:1020px;padding:14px 26px;border-radius:18px;background:rgba(15,16,18,.92);color:#fff;font:500 25px/1.3 Geist,Inter,system-ui,sans-serif;letter-spacing:-.01em;text-align:center;box-shadow:0 20px 40px -20px rgba(0,0,0,.6);pointer-events:none}';
const W = 1600;
const H = 900;

for (const f of [join(ROOT, '.env.local'), join(homedir(), 'Desktop/twokey/.env.local')]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*(ELEVENLABS_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
}

type Line = { text: string; say: string };
const LINES = {
  intro: {
    text: 'AI agents can pay bills now. Letting them is the hard part.',
    say: "AI agents can pay bills now. The hard part is letting them... without handing over the keys to your treasury.",
  },
  idea: {
    text: 'Twokey: the two-key rule for agents that pay in USDC on Arc.',
    say: "Twokey is the two-key rule for agents that pay in USDC on Arc. Routine payments go on their own, risky ones wait for your key, and anything that breaks a rule is refused.",
  },
  signup: {
    text: 'Anyone can try it: sign up for a free sandbox.',
    say: "Anyone can try it. Sign up for a free sandbox: just an email and a password.",
  },
  wallet: {
    text: 'Twokey creates your own Circle wallet on Arc Testnet, and funds it.',
    say: "Twokey creates your own Circle developer-controlled wallet on Arc Testnet, and funds it with test USDC. That's a real wallet, created in a few seconds.",
  },
  mandate: {
    text: 'You decide what the agent may pay on its own.',
    say: "Then you decide what your agent may pay on its own. Fifty cents a payment, a dollar fifty a day, and two payees you trust.",
  },
  sign: {
    text: 'Hold to sign: that is mandate version one.',
    say: "Hold to sign. That's mandate version one, and every version is kept.",
  },
  badge: {
    text: "Your agent gets a badge: the mandate it carries, and a key that can only ask.",
    say: "Your agent gets a badge. It carries the mandate into every payment, and its key can ask... but it can never approve, and it never sees a wallet.",
  },
  scratch: {
    text: 'The key is shown once. Scratch it off.',
    say: "The key is shown once, so you scratch it off.",
  },
  inside: {
    text: 'Inside the mandate: paid on Arc in seconds, through Circle Wallets.',
    say: "Now the agent asks to pay ten cents to a pinned payee. That's inside the mandate, so Circle Wallets pays it on Arc, in a few seconds, with the transaction on the record.",
  },
  outside: {
    text: 'Sixty cents is over the cap, so it waits for you.',
    say: "Now it asks for sixty cents. That's over the cap, so it doesn't fail, and it doesn't just go. It waits for you, sealed to the exact terms.",
  },
  hold: {
    text: 'You hold to approve. The executor re-checks the seal, then pays.',
    say: "You check the seal and hold to approve. Right before paying, the executor re-checks that seal. If even one cent had changed, nothing would be sent.",
  },
  audit: {
    text: 'Every decision is on a hash-chained record.',
    say: "And every decision lands on a hash-chained audit log, with the Circle transaction and the Arc hash, so finance can check it without trusting the agent.",
  },
  mainnet: {
    text: "And it's live on Arc mainnet, moving real USDC.",
    say: "This isn't only a testnet demo. Twokey's own treasury runs on Arc mainnet, through the same code, with real USDC.",
  },
  outro: {
    text: 'Twokey on Arc · twokey.si · open source on GitHub',
    say: "Twokey on Arc. Try the sandbox at twokey dot s i. The code is open source on GitHub.",
  },
} satisfies Record<string, Line>;
type Key = keyof typeof LINES;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const seconds = (file: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

async function speak(text: string, file: string) {
  const voice = process.env.ELEVENLABS_VOICE_ID ?? 'iP95p4xoKVk53GoZ742B';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2',
      voice_settings: { stability: 0.42, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

/** Voice first, so each caption stays up exactly as long as its line takes to say. Cached by wording. */
async function synthesize() {
  mkdirSync(AUDIO, { recursive: true });
  const eleven = !!process.env.ELEVENLABS_API_KEY;
  const audio = {} as Record<Key, { file: string; seconds: number }>;
  for (const [key, line] of Object.entries(LINES) as [Key, Line][]) {
    const id = createHash('sha256').update(`${eleven}|${line.say}`).digest('hex').slice(0, 16);
    const file = join(AUDIO, `${key}-${id}.${eleven ? 'mp3' : 'aiff'}`);
    if (!existsSync(file)) {
      if (eleven) await speak(line.say, file);
      else execFileSync('say', ['-r', '172', '-o', file, line.say]);
    }
    audio[key] = { file, seconds: seconds(file) };
  }
  return { eleven, audio };
}

/**
 * Screen recording falls behind the wall clock on heavy pages (about 12 s over this video), so each voice line is
 * placed where its caption actually appears in the frames, found by scene changes in the caption strip.
 */
function captionTimesMs(raw: string, cues: { key: Key; atMs: number }[]): number[] {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', raw, '-vf', "crop=1100:76:250:796,select='gt(scene,0.06)',showinfo", '-an', '-f', 'null', '-'], { encoding: 'utf8' });
  const changes = [...r.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 1000));
  let offset = 0;
  let last = -1;
  return cues.map((c) => {
    const hit = changes.find((t) => t > last && t >= c.atMs + offset - 300 && t <= c.atMs + offset + 8000);
    const at = hit ?? c.atMs + offset;
    offset = at - c.atMs;
    last = at;
    return at;
  });
}

function mux(raw: string, cues: { key: Key; atMs: number }[], audio: Record<Key, { file: string; seconds: number }>) {
  const times = captionTimesMs(raw, cues);
  console.log(`caption lag (s): ${times.map((t, i) => ((t - cues[i]!.atMs) / 1000).toFixed(1)).join(' ')}`);
  writeFileSync(join(OUT, 'cues-video.json'), JSON.stringify(cues.map((c, i) => ({ key: c.key, atMs: times[i] }))));
  const inputs = ['-y', '-i', raw];
  const filters: string[] = [];
  cues.forEach((cue, i) => {
    inputs.push('-i', audio[cue.key].file);
    filters.push(`[${i + 1}:a]adelay=${times[i]}|${times[i]}[a${i}]`);
  });
  const mix = `${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
  const mp4 = join(OUT, 'twokey-on-arc.mp4');
  execFileSync(
    'ffmpeg',
    [...inputs, '-filter_complex', [...filters, mix].join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart', mp4],
    { stdio: 'ignore' },
  );
  const pub = join(ROOT, 'apps/web/public/video');
  mkdirSync(pub, { recursive: true });
  copyFileSync(mp4, join(pub, 'twokey-on-arc.mp4'));
  console.log(`video: ${mp4} (${seconds(mp4).toFixed(1)} s)`);
}

async function main() {
  // `--mux-only` rebuilds the MP4 from the last recording and the cached voice lines.
  if (process.argv.includes('--mux-only')) {
    const { audio } = await synthesize();
    const rawDir = join(OUT, 'raw');
    mux(join(rawDir, readdirSync(rawDir).find((f) => f.endsWith('.webm'))!), JSON.parse(readFileSync(join(OUT, 'cues.json'), 'utf8')), audio);
    return;
  }
  rmSync(join(OUT, 'raw'), { recursive: true, force: true });
  const { eleven, audio } = await synthesize();
  console.log(`voice: ${Object.keys(audio).length} lines via ${eleven ? 'ElevenLabs' : 'say'}`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const rawDir = join(OUT, 'raw');
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: rawDir, size: { width: W, height: H } },
    extraHTTPHeaders: { 'x-real-ip': `192.0.2.${Date.now() % 250}` },
  });
  // A visible cursor and a caption pill, on every page. Plain JS strings: tsx would inject helpers the page lacks.
  await context.addInitScript({
    content: `(() => {
      const css = document.createElement('style');
      css.textContent = ${JSON.stringify(OVERLAY_CSS)};
      const cur = document.createElement('div');
      cur.id = 'rec-cur';
      cur.style.left = '-50px';
      window.setCap = (s) => {
        sessionStorage.setItem('rec-cap', s);
        let el = document.getElementById('rec-cap');
        if (!el) { el = document.createElement('div'); el.id = 'rec-cap'; document.documentElement.appendChild(el); }
        el.textContent = s;
      };
      const mount = () => {
        const root = document.documentElement;
        root.appendChild(css);
        root.appendChild(cur);
        addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
        addEventListener('mousedown', () => cur.classList.add('down'), true);
        addEventListener('mouseup', () => cur.classList.remove('down'), true);
        // React hydration can drop nodes it did not render; put the overlay back if it goes.
        setInterval(() => {
          if (!css.isConnected) root.appendChild(css);
          if (!cur.isConnected) root.appendChild(cur);
          const t = sessionStorage.getItem('rec-cap');
          if (t && !document.getElementById('rec-cap')) window.setCap(t);
        }, 200);
        const t = sessionStorage.getItem('rec-cap');
        if (t) window.setCap(t);
      };
      if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount); else mount();
    })();`,
  });

  const page = await context.newPage();
  const t0 = Date.now();
  const cues: { key: Key; atMs: number }[] = [];

  const say = async (key: Key, extraMs = 400, wait = true) => {
    cues.push({ key, atMs: Date.now() - t0 });
    await page.evaluate(`window.setCap(${JSON.stringify(LINES[key].text)})`).catch((e: Error) => console.warn('caption failed:', e.message));
    if (wait) await sleep(audio[key].seconds * 1000 + extraMs);
  };
  const glide = (x: number, y: number, steps = 18) => page.mouse.move(x, y, { steps });
  const at = async (sel: string) => {
    const loc = page.locator(sel).first();
    await loc.scrollIntoViewIfNeeded();
    const b = (await loc.boundingBox())!;
    return { loc, x: b.x + b.width / 2, y: b.y + b.height / 2, b };
  };
  const click = async (sel: string) => {
    const t = await at(sel);
    await glide(t.x, t.y);
    await sleep(250);
    await page.mouse.down();
    await page.mouse.up();
  };
  const type = async (sel: string, text: string) => {
    await click(sel);
    await page.keyboard.type(text, { delay: 45 });
  };
  const hold = async (sel: string, ms = 1700) => {
    const t = await at(sel);
    await glide(t.b.x + 34, t.y);
    await sleep(300);
    await page.mouse.down();
    await sleep(ms);
    await page.mouse.up();
  };
  const settle = (ms = 900) => sleep(ms);

  try {
    // 1. The landing, live on twokey.si.
    await page.goto(SITE, { waitUntil: 'networkidle' });
    await say('intro', 200);
    await page.evaluate(() => document.getElementById('live')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await say('idea', 300);

    // 2. Sign up for a sandbox.
    await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
    await say('signup', 0, false);
    await type('input[name=email]', `maya+${Date.now() % 100000}@northwind.co`);
    await type('input[name=password]', 'a long sandbox password');
    await type('input[name=workspace]', 'Northwind Ops');
    await sleep(Math.max(0, audio.signup.seconds * 1000 - 5200));
    await click('button[type=submit]');
    await page.waitForURL('**/app**', { timeout: 30000, waitUntil: 'commit' });
    await settle(1200);
    await say('wallet', 300, false);
    const sayUntil = Date.now() + audio.wallet.seconds * 1000 + 300;
    await page.locator('.dock li.n:has-text("Sign your mandate")').waitFor({ timeout: 120000 });
    await sleep(Math.max(0, sayUntil - Date.now()));
    await settle(800);

    // 3. The mandate.
    await click('.dock-go');
    await page.waitForURL((u) => u.search.includes('setup=mandate'), { waitUntil: 'commit' });
    await settle(900);
    await say('mandate', 200);
    await say('sign', 0, false);
    await hold('.setup-sheet .hold');
    await page.waitForURL((u) => u.search.includes('setup=telegram'), { timeout: 20000, waitUntil: 'commit' });
    await settle(1000);
    await click('button:has-text("Skip")');
    await page.waitForURL((u) => u.search.includes('setup=key'), { timeout: 20000, waitUntil: 'commit' });
    await settle(900);

    // 4. The badge and the key.
    await say('badge', 200);
    await click('button:has-text("Issue the agent key")');
    await page.locator('.scr canvas').waitFor();
    await say('scratch', 0, false);
    const c = (await page.locator('.scr canvas').boundingBox())!;
    await glide(c.x + 10, c.y + 12);
    await page.mouse.down();
    for (let row = 10; row < c.height; row += 16) {
      await page.mouse.move(c.x + c.width - 10, c.y + row, { steps: 14 });
      await page.mouse.move(c.x + 10, c.y + row + 8, { steps: 14 });
    }
    await page.mouse.up();
    await settle(1200);
    const agentKey = (await page.locator('.scr-key').innerText()).trim();

    // 5. Inside the mandate.
    await say('inside', 0, false);
    const insideUntil = Date.now() + audio.inside.seconds * 1000 + 400;
    await click('button:has-text("Send a test payment")');
    await page.waitForURL((u) => u.pathname === '/app' && !u.search.includes('setup'), { timeout: 20000, waitUntil: 'commit' });
    for (let i = 0; i < 30 && !(await page.locator('.lane-paid .it:not(:has(.ex))').count()); i++) await sleep(1500);
    await sleep(Math.max(1500, insideUntil - Date.now()));

    // 6. Outside the mandate: it waits for the owner's hold.
    const ask = await page.evaluate(async (k) => {
      const r = await fetch('/api/v1/payments', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${k}`, 'idempotency-key': `inv-88-${Date.now()}` },
        body: JSON.stringify({ payee: { payeeId: 'pay_harbor_cloud' }, amount: '0.60', memo: 'INV-88 cloud hosting' }),
      });
      return (await r.json()) as { id?: string; paymentId?: string };
    }, agentKey);
    await page.goto(`${BASE}/app?id=${ask.paymentId ?? ask.id}`, { waitUntil: 'networkidle' });
    await settle(600);
    await say('outside', 300);
    await say('hold', 0, false);
    const holdUntil = Date.now() + audio.hold.seconds * 1000 + 300;
    await hold('.sheet .hold, .focus .hold', 1600);
    for (let i = 0; i < 80 && (await page.locator('.lane-paid .it').count()) < 2; i++) await sleep(1500);
    await sleep(Math.max(1200, holdUntil - Date.now()));

    // 7. The audit log.
    await page.goto(`${BASE}/app/audit`, { waitUntil: 'networkidle' });
    await say('audit', 600);

    // 8. Mainnet, on the Arc explorer.
    await page.goto(`https://explorer.arc.io/address/${MAINNET_TREASURY}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => undefined);
    await settle(3000);
    await say('mainnet', 800);

    // 9. Out.
    await page.goto(`${SITE}/#developers`, { waitUntil: 'networkidle' });
    await say('outro', 1200);
  } finally {
    await context.close();
    await browser.close();
  }

  const raw = join(rawDir, readdirSync(rawDir).find((f) => f.endsWith('.webm'))!);
  writeFileSync(join(OUT, 'cues.json'), JSON.stringify(cues));
  mux(raw, cues, audio);
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
