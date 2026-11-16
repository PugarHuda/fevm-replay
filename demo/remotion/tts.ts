// Voice for every scene (edge-tts) plus timings: captions and the time each
// cue phrase is spoken. Writes public/audio/<id>.mp3 and src/timing.json.
// usage: node tts.ts [sceneId ...]   (default: all; others keep old timings)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenes, VOICE, RATE, spoken, shown, type Scene } from './src/scenes.ts';

type Word = { t: number; d: number; w: string };
export type Timing = {
  audio: number; // seconds of speech
  captions: { start: number; end: number; text: string }[];
  cues: Record<string, number>; // phrase -> seconds into the audio
};

mkdirSync('public/audio', { recursive: true });
const out: Record<string, Timing> = existsSync('src/timing.json') ? JSON.parse(readFileSync('src/timing.json', 'utf8')) : {};
const only = process.argv.slice(2);

// Caption chunks: split the marked-up narration at sentence ends, then long
// sentences at commas/colons, so each chunk fits two caption lines.
function chunks(markup: string, max = 90): string[] {
  const parts: string[] = [];
  const merged = markup.split(/(?<=[.?!:;])\s+/).filter(Boolean);
  for (const s of merged) {
    if (shown(s).length <= max) { parts.push(s); continue; }
    let rest = s;
    while (shown(rest).length > max) {
      const commas = [...rest.matchAll(/, /g)].map((m) => m.index!).filter((i) => shown(rest.slice(0, i)).length <= max && i > 20);
      let cut = commas.length ? commas[commas.length - 1] + 1 : rest.lastIndexOf(' ', max);
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    parts.push(rest);
  }
  return parts;
}

for (const sc of scenes as Scene[]) {
  if (only.length && !only.includes(sc.id)) continue;
  const say = spoken(sc.narration);
  const tf = join(tmpdir(), `tts-${sc.id}.txt`);
  writeFileSync(tf, say);
  const mp3 = `public/audio/${sc.id}.mp3`;
  // the service sometimes answers with no audio; ask again
  let raw = '';
  for (let k = 0; !raw; k++) {
    try { raw = execFileSync('python', ['tts_one.py', VOICE, RATE, tf, mp3], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (e) { if (k === 3) throw e; }
  }
  const words: Word[] = JSON.parse(raw);
  const audio = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3], { encoding: 'utf8' }));

  // character offset in `say` of every word boundary
  let pos = 0;
  const at = words.map((w) => {
    const i = say.indexOf(w.w, pos);
    if (i < 0) throw new Error(`${sc.id}: word "${w.w}" not found after ${pos}`);
    pos = i + w.w.length;
    return { ...w, i };
  });
  const timeAt = (offset: number) => (at.find((w) => w.i >= offset) ?? at[at.length - 1]).t;

  const caps: Timing['captions'] = [];
  let cpos = 0;
  for (const c of chunks(sc.narration)) {
    const sp = spoken(c);
    const i = say.indexOf(sp, cpos);
    if (i < 0) throw new Error(`${sc.id}: chunk "${sp}" not found`);
    cpos = i + sp.length;
    caps.push({ start: timeAt(i), end: 0, text: shown(c) });
  }
  caps.forEach((c, k) => (c.end = k + 1 < caps.length ? caps[k + 1].start : at[at.length - 1].t + at[at.length - 1].d + 0.3));

  const cues: Record<string, number> = {};
  for (const p of [...(sc.cues ?? []).map((c) => c.at), ...(sc.actions ?? []).map((a) => a.at)].filter((p) => p !== '^')) {
    const i = say.toLowerCase().indexOf(p.toLowerCase(), 0);
    if (i < 0) throw new Error(`${sc.id}: cue phrase "${p}" not in narration`);
    cues[p] = timeAt(i);
  }
  out[sc.id] = { audio, captions: caps, cues };
  console.log(`${sc.id}: ${audio.toFixed(1)}s, ${caps.length} captions, ${Object.keys(cues).length} cues`);
  writeFileSync('src/timing.json', JSON.stringify(out, null, 1));
}
writeFileSync('src/timing.json', JSON.stringify(out, null, 1));
