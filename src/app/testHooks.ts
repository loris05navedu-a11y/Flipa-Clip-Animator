import { useApp } from './store';
import { getRepo } from './services';
import { readCtx } from '../engine/canvas';

/**
 * Inspection hooks for end-to-end tests. Only installed when the page is
 * opened with `?e2e` in the URL; they expose nothing that the UI cannot do.
 */
export function installTestHooks(): void {
  if (!/[?&]e2e\b/.test(location.search)) return;
  // Project → canvas-element coordinates, using the live viewport transform.
  (window as unknown as { __flView: unknown }).__flView = (x: number, y: number) => {
    const s = useApp.getState().session;
    const vp = (s as unknown as { __vp?: { screenOf: (x: number, y: number) => { x: number; y: number } } })?.__vp;
    return vp ? vp.screenOf(x, y) : null;
  };
  (window as unknown as { __fl: unknown }).__fl = {
    session: () => useApp.getState().session,
    repo: getRepo,
    /** RGBA of a pixel in the rendered current frame (project coordinates). */
    async pixel(x: number, y: number, frame?: number): Promise<number[]> {
      const s = useApp.getState().session!;
      const c = await s.renderFrame(frame ?? s.frameIndex, 1, { background: false, references: 'none' });
      return [...readCtx(c).getImageData(x, y, 1, 1).data];
    },
    /** Count of non-transparent pixels in a frame (optionally one layer). */
    async inked(frame?: number): Promise<number> {
      const s = useApp.getState().session!;
      const c = await s.renderFrame(frame ?? s.frameIndex, 0.25, { background: false, references: 'none' });
      const d = readCtx(c).getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
      return n;
    },
  };
}
