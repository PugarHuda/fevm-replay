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
