import { Composition } from 'remotion';
import { Tour, totalFrames } from './Tour.tsx';
import { FPS } from './scenes.ts';

export const Root = () => (
  <Composition id="Tour" component={Tour} durationInFrames={totalFrames()} fps={FPS} width={1920} height={1080} />
);
