// Box and zoom geometry, shared by the composition and check.ts.
import { VIEW, FRAME } from './scenes.ts';

export type Box = { x: number; y: number; w: number; h: number };
export type Highlight = { start: number; end: number; box: Box; zoom?: number; at: string };
export type Cam = { s: number; tx: number; ty: number };
export const ID: Cam = { s: 1, tx: 0, ty: 0 };

const K = FRAME.w / VIEW.w; // CSS px of the capture -> px of FRAME
const PAD = 9;

// highlight box in FRAME px, padded
export const frameBox = (b: Box): Box => ({ x: b.x * K - PAD, y: b.y * K - PAD, w: b.w * K + 2 * PAD, h: b.h * K + 2 * PAD });

export type Caption = { start: number; end: number; text: string };
export const CAPTION_MAX = 150; // characters: two lines of the 38 px caption font in the band

// merge captions of fewer than 4 words into a neighbor, while the result fits two lines
export function mergeCaptions(cs: Caption[]): Caption[] {
  const out = cs.map((c) => ({ ...c }));
  const words = (c: Caption) => c.text.split(/\s+/).length;
  for (let i = 0; i < out.length; ) {
    if (words(out[i]) >= 4 || out.length === 1) { i++; continue; }
    const next = out[i + 1], prev = out[i - 1];
    const withNext = next && out[i].text.length + next.text.length + 1 <= CAPTION_MAX;
    const withPrev = prev && prev.text.length + out[i].text.length + 1 <= CAPTION_MAX;
    if (withNext && (!withPrev || next.text.length <= prev.text.length)) {
      out.splice(i, 2, { start: out[i].start, end: next.end, text: out[i].text + ' ' + next.text });
    } else if (withPrev) {
      out.splice(i - 1, 2, { start: prev.start, end: out[i].end, text: prev.text + ' ' + out[i].text });
      i--;
    } else i++;
  }
  return out;
}

// camera that fits the box: scale toward it, never showing outside the capture
export function camFor(h: Highlight): Cam {
  const b = frameBox(h.box);
  let s = h.zoom ?? Math.min(1.9, (0.82 * FRAME.w) / b.w, (0.62 * FRAME.h) / b.h);
  if (s < 1.12) s = 1;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    s,
    tx: clamp(FRAME.w / 2 - s * (b.x + b.w / 2), FRAME.w - s * FRAME.w, 0),
    ty: clamp(FRAME.h / 2 - s * (b.y + b.h / 2), FRAME.h - s * FRAME.h, 0),
  };
}
