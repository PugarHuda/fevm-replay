import React from 'react';
import { AbsoluteFill, Audio, Easing, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { scenes, FPS, LEAD, TAIL, TITLE_SECONDS, FRAME, CAPTION, type Scene } from './scenes.ts';
import { camFor, frameBox, mergeCaptions, ID, type Cam, type Highlight } from './camera.ts';
import timingJson from './timing.json';
import captureJson from './capture.json';

const timing = timingJson as Record<string, { audio: number; captions: { start: number; end: number; text: string }[] }>;
const capture = captureJson as Record<string, { length: number; highlights: Highlight[] }>;

const FONT = "'Segoe UI', 'Inter', system-ui, sans-serif";
const RAMP = 0.6;

export const sceneLength = (s: Scene) => LEAD + timing[s.id].audio + TAIL;
const sceneFrames = (s: Scene) => Math.round(sceneLength(s) * FPS);
export const totalFrames = () => Math.round(TITLE_SECONDS * FPS) + scenes.reduce((n, s) => n + sceneFrames(s), 0);

function camAt(hs: Highlight[], t: number): Cam {
  const keys: { t: number; c: Cam }[] = [{ t: 0, c: ID }];
  hs.forEach((h, i) => {
    const c = camFor(h);
    const last = keys[keys.length - 1];
    if (h.start > last.t) keys.push({ t: h.start, c: last.c });
    keys.push({ t: Math.min(h.start + RAMP, h.end), c });
    keys.push({ t: Math.max(h.end, h.start + RAMP), c });
    const next = hs[i + 1];
    if (!next || next.start - h.end > 0.5) keys.push({ t: Math.max(h.end, h.start + RAMP) + RAMP, c: ID });
  });
  for (let i = keys.length - 1; i >= 0; i--) {
    if (t < keys[i].t) continue;
    const a = keys[i], b = keys[i + 1];
    if (!b || b.t <= a.t) return a.c;
    const k = Easing.inOut(Easing.cubic)(Math.min(1, (t - a.t) / (b.t - a.t)));
    return { s: a.c.s + (b.c.s - a.c.s) * k, tx: a.c.tx + (b.c.tx - a.c.tx) * k, ty: a.c.ty + (b.c.ty - a.c.ty) * k };
  }
  return ID;
}

const Captions: React.FC<{ id: string }> = ({ id }) => {
  const t = useCurrentFrame() / FPS - LEAD;
  const c = mergeCaptions(timing[id].captions).find((c) => t >= c.start && t < c.end);
  return (
    <div style={{ position: 'absolute', left: 0, top: CAPTION.y, width: 1920, height: CAPTION.h, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {c && (
        <div style={{ maxWidth: 1640, textAlign: 'center', color: '#f4f6f5', fontFamily: FONT, fontSize: 38, lineHeight: 1.25, fontWeight: 500, letterSpacing: 0.1 }}>
          {c.text}
        </div>
      )}
    </div>
  );
};

const Frame: React.FC<{ children: React.ReactNode; fade: number }> = ({ children, fade }) => (
  <div style={{ position: 'absolute', left: FRAME.x, top: FRAME.y, width: FRAME.w, height: FRAME.h, overflow: 'hidden', borderRadius: 14, opacity: fade, boxShadow: '0 18px 50px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08)', background: '#0d1117' }}>
    {children}
  </div>
);

const Capture: React.FC<{ scene: Scene }> = ({ scene }) => {
  const t = useCurrentFrame() / FPS;
  const hs = capture[scene.id]?.highlights ?? [];
  const cam = camAt(hs, t);
  return (
    <div style={{ position: 'absolute', width: FRAME.w, height: FRAME.h, transformOrigin: '0 0', transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})` }}>
      <OffthreadVideo src={staticFile(`clips/${scene.id}.mp4`)} muted style={{ width: FRAME.w, height: FRAME.h }} />
      {hs.map((h, i) => {
        const o = Math.min(interpolate(t, [h.start, h.start + 0.25], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), interpolate(t, [h.end - 0.2, h.end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
        if (o <= 0) return null;
        const b = frameBox(h.box);
        const grow = interpolate(o, [0, 1], [1.04, 1]);
        return (
          <div key={i} style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, opacity: o, transform: `scale(${grow})`, border: `${4 / cam.s}px solid #f5b400`, borderRadius: 8 / cam.s, boxShadow: `0 0 0 4000px rgba(10,14,16,${0.22 * o}), 0 0 ${18 / cam.s}px rgba(245,180,0,.55)` }} />
        );
      })}
    </div>
  );
};

const Card: React.FC<{ scene: Scene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const c = scene.card!;
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 30% 20%, #1b2a26 0%, #0d1117 70%)', fontFamily: FONT, color: '#eef2f0', padding: '0 120px', justifyContent: 'center' }}>
      <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: -2 }}>{c.title}</div>
      {c.bullets?.map((b, i) => (
        <div key={i} style={{ fontSize: 36, marginTop: i ? 14 : 38, opacity: interpolate(f, [10 + i * 12, 22 + i * 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), display: 'flex', gap: 18 }}>
          <span style={{ color: '#4fb894' }}>✓</span><span>{b}</span>
        </div>
      ))}
      {c.sub && <div style={{ fontSize: 32, color: '#4fb894', marginTop: 46, fontFamily: "Consolas, 'Cascadia Mono', monospace" }}>{c.sub}</div>}
    </AbsoluteFill>
  );
};

const SceneView: React.FC<{ scene: Scene; frames: number }> = ({ scene, frames }) => {
  const f = useCurrentFrame();
  const fade = Math.min(interpolate(f, [0, 9], [0, 1], { extrapolateRight: 'clamp' }), interpolate(f, [frames - 6, frames], [1, 0], { extrapolateLeft: 'clamp' }));
  return (
    <AbsoluteFill>
      <Frame fade={fade}>{scene.kind === 'card' ? <Card scene={scene} /> : <Capture scene={scene} />}</Frame>
      <Captions id={scene.id} />
      <Sequence from={Math.round(LEAD * FPS)}>
        <Audio src={staticFile(`audio/${scene.id}.mp3`)} />
      </Sequence>
    </AbsoluteFill>
  );
};

const Title: React.FC = () => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 12, TITLE_SECONDS * FPS - 8, TITLE_SECONDS * FPS], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 170px', fontFamily: FONT, color: '#eef2f0', opacity: o }}>
      <div style={{ fontSize: 120, fontWeight: 800, letterSpacing: -3 }}>fevm-replay</div>
      <div style={{ fontSize: 42, color: '#b7c2bd', marginTop: 18, lineHeight: 1.3 }}>Real Ethereum mainnet history, replayed in fevm,<br />the EVM written in Fe, and proven against the chain.</div>
      <div style={{ fontSize: 28, color: '#4fb894', marginTop: 40 }}>Fe Builders Challenge 2026</div>
    </AbsoluteFill>
  );
};

export const Tour: React.FC = () => {
  let from = Math.round(TITLE_SECONDS * FPS);
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, #11171a 0%, #0a0e10 100%)' }}>
      <Sequence durationInFrames={from}><Title /></Sequence>
      {scenes.map((s) => {
        const n = sceneFrames(s);
        const el = (
          <Sequence key={s.id} from={from} durationInFrames={n}>
            <SceneView scene={s} frames={n} />
          </Sequence>
        );
        from += n;
        return el;
      })}
    </AbsoluteFill>
  );
};
