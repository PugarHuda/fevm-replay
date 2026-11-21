// Drives a real Chromium through each scene like a user (visible cursor,
// eased scrolling, clicks, hovers, typing), records it with the DevTools
// screencast (sharper than recordVideo), and measures every highlighted
// element at the moment its box appears. Writes public/clips/<id>.mp4 and
// src/capture.json (box per highlight, CSS px of the 1536x864 viewport).
//
// usage: node capture/capture.ts [sceneId ...]     BASE=<url> to override
import { chromium, type Page, type CDPSession } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { join, resolve } from 'node:path';
import { scenes, VIEW, LEAD, TAIL, type Scene, type Target, type Cue } from '../src/scenes.ts';

const BASE = process.env.BASE ?? 'https://fevm-replay.vercel.app/';
const timing = JSON.parse(readFileSync('src/timing.json', 'utf8'));
const capPath = 'src/capture.json';
const capture: Record<string, any> = existsSync(capPath) ? JSON.parse(readFileSync(capPath, 'utf8')) : {};
const only = process.argv.slice(2);
mkdirSync('public/clips', { recursive: true });

export type Box = { x: number; y: number; w: number; h: number };
export type Highlight = { start: number; end: number; box: Box; zoom?: number; at: string };

const CURSOR = `(() => {
  const make = () => {
    if (document.getElementById('__cursor')) return;
    const c = document.createElement('div');
    c.id = '__cursor';
    c.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 1.5 L2 23 L7.6 17.6 L11.4 26.5 L15.2 24.9 L11.5 16.2 L19 16.2 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-60px,-60px);filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))';
    document.documentElement.appendChild(c);
    const p = JSON.parse(sessionStorage.getItem('__cur') || 'null');
    if (p) c.style.transform = 'translate(' + (p[0] - 2) + 'px,' + (p[1] - 1) + 'px)';
    addEventListener('mousemove', (e) => {
      c.style.transform = 'translate(' + (e.clientX - 2) + 'px,' + (e.clientY - 1) + 'px)';
      sessionStorage.setItem('__cur', JSON.stringify([e.clientX, e.clientY]));
    }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:3px solid #f5b400;left:' + e.clientX + 'px;top:' + e.clientY + 'px;transition:transform .45s ease-out,opacity .45s ease-out';
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  document.documentElement ? make() : addEventListener('DOMContentLoaded', make);
  addEventListener('DOMContentLoaded', () => { document.documentElement.style.scrollBehavior = 'auto'; make(); });
})();`;

const TERM_CSS = `*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0d1117}
body{display:flex;align-items:center;justify-content:center;font-family:'Cascadia Mono',Consolas,monospace}
.win{border-radius:10px;background:#161b22;box-shadow:0 20px 60px rgba(0,0,0,.5);border:1px solid #30363d;overflow:hidden}
.bar{height:38px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#21262d;color:#8b949e;font:14px system-ui,sans-serif}
.bar i{width:12px;height:12px;border-radius:50%;display:inline-block}.bar span{margin-left:12px}
#term{padding:18px 22px 22px;font-size:18px;letter-spacing:-0.04em;line-height:1.5;color:#e6edf3;white-space:pre-wrap;word-break:break-all}
.ln{min-height:1.55em}.c1{font-weight:700}.c32{color:#3fb950}`;

// asciinema v2 output -> HTML, SGR colors only (the casts use bold green for the prompt)
function ansiToHtml(s: string) {
  let open = 0;
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = esc.replace(/\x1b\[([0-9;]*)m/g, (_, c: string) => {
    if (c === '' || c === '0') { const r = '</span>'.repeat(open); open = 0; return r; }
    open++;
    return `<span class="${c.split(';').map((x) => 'c' + x).join(' ')}">`;
  });
  return html + '</span>'.repeat(open);
}
const PROMPT = '\x1b[1;32m$\x1b[0m ';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function measure(page: Page, t: Target): Promise<Box | null> {
  const loc = page.locator(t.sel).first();
  if (!(await loc.count())) return null;
  return loc.evaluate((el, { text, to, line, toLine }) => {
    let r: DOMRect;
    if (line != null) {
      // terminal lines: union of the text extents of lines line..toLine
      const lns = [...el.querySelectorAll('.ln')].slice(line, (toLine ?? line) + 1);
      if (!lns.length) return null;
      const rs = lns.map((l) => { const g = document.createRange(); g.selectNodeContents(l); return g.getBoundingClientRect(); });
      const x = Math.min(...rs.map((q) => q.left)), y = Math.min(...rs.map((q) => q.top));
      return { x, y, w: Math.max(...rs.map((q) => q.right)) - x, h: Math.max(...rs.map((q) => q.bottom)) - y };
    }
    if (!text) r = el.getBoundingClientRect();
    else {
      // whitespace-insensitive search over the element's text nodes
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const map: [Text, number][] = [];
      let flat = '';
      let lastSpace = true;
      while (walker.nextNode()) {
        const n = walker.currentNode as Text;
        for (let k = 0; k < n.data.length; k++) {
          const sp = /\s/.test(n.data[k]);
          if (sp && lastSpace) continue;
          flat += sp ? ' ' : n.data[k];
          map.push([n, k]);
          lastSpace = sp;
        }
      }
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const i = flat.indexOf(norm(text));
      if (i < 0) return null;
      const j = to ? flat.indexOf(norm(to), i) + norm(to).length : i + norm(text).length;
      if (to && j < norm(to).length) return null;
      const range = document.createRange();
      range.setStart(map[i][0], map[i][1]);
      range.setEnd(map[j - 1][0], map[j - 1][1] + 1);
      r = range.getBoundingClientRect();
    }
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, { text: t.text, to: t.to, line: t.line, toLine: t.toLine });
}

const visible = (b: Box) => b.y >= 24 && b.y + b.h <= VIEW.h - 24 && b.x >= 0 && b.x + b.w <= VIEW.w;

async function smoothScrollBy(page: Page, dy: number, ms = 800) {
  await page.evaluate(([dy, ms]) => new Promise<void>((done) => {
    const s = scrollY, t0 = performance.now();
    const step = (n: number) => {
      const k = Math.min(1, (n - t0) / ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      scrollTo(0, s + dy * e);
      k < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
  }), [dy, ms]);
}

// scroll delta that brings b into a comfortable spot
function scrollFor(b: Box) {
  if (visible(b)) return 0;
  const top = b.h > VIEW.h * 0.6 ? 40 : VIEW.h * 0.24;
  return b.y - top;
}

async function moveTo(page: Page, from: { x: number; y: number }, x: number, y: number, ms = 450) {
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps, e = 1 - Math.pow(1 - k, 3);
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await sleep(ms / steps / 2);
  }
  from.x = x; from.y = y;
}

// where the cursor rests while a box is shown: just under its left part, so it points at it without covering it
function restPoint(b: Box) {
  const x = Math.min(b.x + Math.min(60, b.w / 3), VIEW.w - 30);
  const below = b.y + b.h + 12;
  return below < VIEW.h - 30 ? { x, y: below } : { x: Math.max(20, b.x - 30), y: Math.min(b.y + 10, VIEW.h - 30) };
}

async function startScreencast(cdp: CDPSession, dir: string) {
  const frames: { t: number; file: string }[] = [];
  let n = 0;
  cdp.on('Page.screencastFrame', async (f: any) => {
    const file = join(dir, `${String(n++).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ t: f.metadata.timestamp, file });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEW.w * VIEW.dpr, maxHeight: VIEW.h * VIEW.dpr, everyNthFrame: 1 });
  return frames;
}

function encode(frames: { t: number; file: string }[], t0: number, length: number, dir: string, out: string) {
  // frames are only sent on change; hold each one until the next
  const start = frames.findLastIndex((f) => f.t <= t0);
  const use = frames.slice(Math.max(0, start));
  let list = '';
  use.forEach((f, i) => {
    const a = Math.max(f.t, t0) - t0;
    const b = i + 1 < use.length ? use[i + 1].t - t0 : length;
    if (b - a <= 0) return;
    list += `file '${resolve(f.file).replace(/\\/g, '/')}'\nduration ${(b - a).toFixed(4)}\n`;
  });
  list += `file '${resolve(use[use.length - 1].file).replace(/\\/g, '/')}'\n`;
  writeFileSync(join(dir, 'list.txt'), list);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
    '-vf', `scale=${VIEW.w * VIEW.dpr}:${VIEW.h * VIEW.dpr}:flags=lanczos,fps=30,format=yuv420p`,
    '-t', length.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', out]);
}

async function run(sc: Scene, browser: any) {
  const tm = timing[sc.id];
  if (!tm) throw new Error(`no timing for ${sc.id}: run tts first`);
  const length = LEAD + tm.audio + TAIL;
  const T = (phrase: string) => {
    if (phrase === '^') return 0.15;
    if (tm.cues[phrase] === undefined) throw new Error(`${sc.id}: no timing for "${phrase}": run node tts.ts ${sc.id}`);
    return LEAD + tm.cues[phrase];
  };

  const ctx = await browser.newContext({ viewport: { width: VIEW.w, height: VIEW.h }, deviceScaleFactor: VIEW.dpr, colorScheme: 'light' });
  await ctx.addInitScript(CURSOR);
  const page: Page = await ctx.newPage();
  const mouse = { x: VIEW.w * 0.62, y: VIEW.h * 0.7 };

  let cast: [number, string, string][] = [];
  if (sc.kind === 'cast') {
    const lines = readFileSync(join('..', 'casts', sc.cast!), 'utf8').split('\n').filter(Boolean);
    const { height: rows, width: cols } = JSON.parse(lines[0]) as { height: number; width: number };
    cast = lines.slice(1).map((l) => JSON.parse(l)).filter((e) => e[1] === 'o');
    await page.setContent(`<!doctype html><meta charset=utf-8><style>${TERM_CSS}</style><div class=win><div class=bar><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>${sc.termTitle ?? ''}</span></div><div id=term style="width:calc(${cols} * (1ch - 0.04em) + 47px);min-height:${rows * 1.5 * 18 + 40}px"></div></div>`);
  } else {
    await page.goto(new URL(sc.url!, BASE).href, { waitUntil: 'networkidle' });
    if (sc.start) {
      const b = await measure(page, sc.start);
      if (b) await page.evaluate((y) => scrollTo(0, y), b.y - 30);
    }
  }
  await page.mouse.move(mouse.x, mouse.y);
  await sleep(400);

  const dir = join('public/clips', `_${sc.id}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = await startScreencast(cdp, dir);
  await sleep(300);
  const t0 = Date.now() / 1000;
  const now = () => Date.now() / 1000 - t0;
  const until = async (t: number) => { const d = t - now(); if (d > 0) await sleep(d * 1000); };

  let castFinished = sc.kind !== 'cast';
  const castDone = sc.kind !== 'cast' ? Promise.resolve() : (async () => {
    // Plays alongside the boxes below. Real output at its real times (idle gaps over 1 s shortened to 1 s);
    // a prompt line's command is typed out, which takes under a second.
    let clock = 0.3, prev = 0, fresh = true;
    const add = (html: string, newLine: boolean) => page.evaluate(([h, nl]) => {
      const t = document.getElementById('term')!;
      if (nl || !t.lastElementChild) { const d = document.createElement('div'); d.className = 'ln'; t.appendChild(d); }
      t.lastElementChild!.insertAdjacentHTML('beforeend', h);
    }, [html, newLine] as const);
    for (const [t, , data] of cast) {
      clock += Math.min(t - prev, 1.0);
      prev = t;
      await until(clock);
      const pieces = data.replace(/\r(?!\n)/g, '').split('\r\n');
      for (let i = 0; i < pieces.length; i++) {
        let piece = pieces[i];
        if (piece || i < pieces.length - 1) {
          if (fresh && piece.startsWith(PROMPT)) {
            await add(ansiToHtml(PROMPT), true);
            fresh = false;
            const cmd = piece.slice(PROMPT.length);
            const per = Math.min(40, 700 / cmd.length);
            for (let k = 0; k < cmd.length; k += 2) { await add(ansiToHtml(cmd.slice(k, k + 2)), false); await sleep(per * 2); }
            await sleep(250);
            clock = now();
          } else if (piece) { await add(ansiToHtml(piece), fresh); fresh = false; }
          else if (fresh) await add('', true);
        }
        if (i < pieces.length - 1) fresh = true;
      }
    }
    castFinished = true;
  })();

  type Ev = { t: number; cue?: Cue; act?: NonNullable<Scene['actions']>[number] };
  const evs: Ev[] = [
    ...(sc.cues ?? []).map((c) => ({ t: T(c.at), cue: c })),
    ...(sc.actions ?? []).map((a) => ({ t: T(a.at), act: a })),
  ].sort((a, b) => a.t - b.t);

  const hs: Highlight[] = [];
  const endPrev = (t: number) => { const p = hs[hs.length - 1]; if (p && p.end > t) p.end = t; };

  for (const ev of evs) {
    const target = ev.cue?.target ?? ev.act!.target;
    // a box on a cast line waits until that line is complete (the next one has begun)
    while (!castFinished && target.line != null &&
      (await page.locator('#term .ln').count()) <= (target.toLine ?? target.line) + 1) await sleep(40);
    let b = await measure(page, target);
    // A target the page is still making (a verdict after a run): wait for it, up to the cue's time.
    if (!b) { await until(ev.t - 0.6); for (let i = 0; !b && i < 40; i++) { await sleep(100); b = await measure(page, target); } }
    if (!b) { console.warn(`  ! ${sc.id}: target not found: ${JSON.stringify(target)}`); continue; }
    const dy = scrollFor(b);
    if (dy) {
      const s = Math.max(now(), ev.t - 1.15);
      endPrev(s - 0.05);
      await until(s);
      await smoothScrollBy(page, dy, 800);
      b = (await measure(page, target))!;
    }
    if (ev.act) {
      const s = Math.max(now(), ev.t - 0.5);
      endPrev(s - 0.05);
      await until(s);
      await moveTo(page, mouse, b.x + Math.min(b.w / 2, 80), b.y + b.h / 2, 420);
      await until(ev.t);
      if (ev.act.do === 'click') {
        const nav = page.waitForEvent('framenavigated', { timeout: 400 }).then(() => true, () => false);
        await page.mouse.down(); await sleep(70); await page.mouse.up();
        if (await nav) await page.waitForLoadState('networkidle').catch(() => {});
        await page.mouse.move(mouse.x + 1, mouse.y);
      }
      continue;
    }
    const rp = restPoint(b);
    const s = Math.max(now(), ev.t - 0.45);
    if (!dy) endPrev(ev.t - 0.02); // same view: the box hands over to the next one
    await until(s);
    await moveTo(page, mouse, rp.x, rp.y, 380);
    await until(ev.t);
    const box = (await measure(page, target))!;
    if (!visible(box)) console.warn(`  ! ${sc.id} "${ev.cue!.at}": box not fully in view: ${JSON.stringify(box)}`);
    hs.push({ at: ev.cue!.at, start: Math.max(ev.t, now() - 0.05), end: length - 0.35, box, zoom: ev.cue!.zoom });
  }
  await castDone;
  await until(length + 0.3);
  await cdp.send('Page.stopScreencast');
  await ctx.close();

  const kept = hs.filter((h) => h.end - h.start >= 0.8);
  if (kept.length < hs.length) console.warn(`  ! ${sc.id}: dropped ${hs.length - kept.length} highlight(s) shorter than 0.8 s`);
  encode(frames, t0, length, dir, join('public/clips', `${sc.id}.mp4`));
  rmSync(dir, { recursive: true, force: true });
  capture[sc.id] = { length, highlights: kept };
  console.log(`${sc.id}: ${length.toFixed(1)}s, ${frames.length} frames, ${kept.length} boxes`);
}

const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome' });
for (const sc of scenes) {
  if (sc.kind === 'card' || (only.length && !only.includes(sc.id))) continue;
  await run(sc, browser);
  writeFileSync(capPath, JSON.stringify(capture, null, 1));
}
await browser.close();
