/// <reference lib="webworker" />
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

/**
 * GIF encoding off the main thread. Messages:
 *  { type: 'start', width, height, loop }
 *  { type: 'frame', rgba: ArrayBuffer, delay, transparent }
 *  { type: 'finish' } -> posts { type: 'done', bytes }
 */
let gif: ReturnType<typeof GIFEncoder> | null = null;
let w = 0,
  h = 0,
  loop = true,
  first = true;

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'start') {
      gif = GIFEncoder();
      w = m.width;
      h = m.height;
      loop = m.loop;
      first = true;
    } else if (m.type === 'frame' && gif) {
      const rgba = new Uint8ClampedArray(m.rgba);
      const format = m.transparent ? 'rgba4444' : 'rgb565';
      const palette = quantize(rgba, 256, { format, oneBitAlpha: m.transparent ? true : false, clearAlpha: m.transparent, clearAlphaThreshold: 64 });
      const index = applyPalette(rgba, palette, format);
      let transparentIndex = -1;
      if (m.transparent) transparentIndex = palette.findIndex((c: number[]) => c.length > 3 && c[3] === 0);
      gif.writeFrame(index, w, h, {
        palette,
        delay: m.delay,
        repeat: first ? (loop ? 0 : -1) : undefined,
        transparent: transparentIndex >= 0,
        transparentIndex: Math.max(0, transparentIndex),
        dispose: m.transparent ? 2 : 1,
      });
      first = false;
      (self as unknown as Worker).postMessage({ type: 'ack' });
    } else if (m.type === 'finish' && gif) {
      gif.finish();
      const bytes = gif.bytes();
      (self as unknown as Worker).postMessage({ type: 'done', bytes }, [bytes.buffer]);
      gif = null;
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: String(err) });
  }
};
