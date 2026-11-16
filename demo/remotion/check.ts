// Layout check: captions never overlap the capture, and every highlight box
// is fully on screen at rest and at full zoom, long enough to read.
// usage: node check.ts   (exit 1 on any problem)
import { readFileSync } from 'node:fs';
import { scenes, FRAME, CAPTION } from './src/scenes.ts';
import { camFor, frameBox, mergeCaptions, CAPTION_MAX, type Highlight } from './src/camera.ts';

const capture = JSON.parse(readFileSync('src/capture.json', 'utf8'));
const timing = JSON.parse(readFileSync('src/timing.json', 'utf8'));
const bad: string[] = [];
if (FRAME.y + FRAME.h > CAPTION.y) bad.push(`FRAME (bottom ${FRAME.y + FRAME.h}) overlaps the caption band (top ${CAPTION.y})`);
if (CAPTION.y + CAPTION.h > 1080) bad.push('caption band runs off the bottom');
for (const s of scenes) {
  for (const c of mergeCaptions(timing[s.id]?.captions ?? [])) {
    if (c.text.split(/\s+/).length < 4) bad.push(`${s.id}: short caption "${c.text}"`);
    if (c.text.length > CAPTION_MAX) bad.push(`${s.id}: caption over two lines "${c.text}"`);
  }
  if (s.kind === 'card') continue;
  const c = capture[s.id];
  if (!c) { bad.push(`${s.id}: not captured`); continue; }
  const want = s.cues?.length ?? 0;
  if (c.highlights.length !== want) bad.push(`${s.id}: ${c.highlights.length} of ${want} boxes captured`);
  for (const h of c.highlights as Highlight[]) {
    const b = frameBox(h.box), cam = camFor(h);
    const z = { x: cam.tx + cam.s * b.x, y: cam.ty + cam.s * b.y, w: cam.s * b.w, h: cam.s * b.h };
    const where = `${s.id} "${h.at}"`;
    if (b.x < -1 || b.y < -1 || b.x + b.w > FRAME.w + 1 || b.y + b.h > FRAME.h + 1) bad.push(`${where}: box off the capture at rest ${JSON.stringify(b)}`);
    if (z.x < -1 || z.y < -1 || z.x + z.w > FRAME.w + 1 || z.y + z.h > FRAME.h + 1) bad.push(`${where}: box cut off at zoom ${cam.s.toFixed(2)}`);
    if (h.end - h.start < 0.8) bad.push(`${where}: shown only ${(h.end - h.start).toFixed(2)} s`);
  }
}
console.log(bad.length ? bad.join('\n') : 'layout ok: captions clear of the capture, every box on screen');
process.exit(bad.length ? 1 : 0);
