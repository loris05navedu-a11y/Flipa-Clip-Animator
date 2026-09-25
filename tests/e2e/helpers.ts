import { expect, type Page } from '@playwright/test';

export async function openApp(page: Page): Promise<void> {
  await page.goto('/?e2e');
  await page.waitForSelector('[data-testid=home]');
}

export async function newProject(page: Page, opts: { name?: string; width?: number; height?: number; frames?: number; transparent?: boolean } = {}): Promise<void> {
  await page.click('[data-testid=new-project]');
  await page.waitForSelector('[data-testid=new-project-dialog]');
  if (opts.name) await page.fill('[data-testid=project-name]', opts.name);
  if (opts.width) {
    await page.fill('[data-testid=project-width]', String(opts.width));
    await page.locator('[data-testid=project-width]').blur();
  }
  if (opts.height) {
    await page.fill('[data-testid=project-height]', String(opts.height));
    await page.locator('[data-testid=project-height]').blur();
  }
  if (opts.frames) {
    await page.fill('[data-testid=project-frames]', String(opts.frames));
    await page.locator('[data-testid=project-frames]').blur();
  }
  if (opts.transparent) await page.locator('[data-testid=project-transparent]').check({ force: true });
  await page.click('[data-testid=create-project]');
  await page.waitForSelector('[data-testid=main-canvas]');
  await page.waitForTimeout(300);
}

/** Canvas point (fractions of the displayed canvas) → client coordinates. */
async function canvasBox(page: Page) {
  const box = await page.locator('[data-testid=main-canvas]').boundingBox();
  if (!box) throw new Error('no canvas');
  return box;
}

/** Map a project coordinate to the client coordinate using the live view transform. */
export async function docToClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await canvasBox(page);
  const p = await page.evaluate(
    ([dx, dy]) => {
      const w = window as unknown as { __fl: { session: () => unknown } };
      void w;
      const canvas = document.querySelector('[data-testid=main-canvas]') as HTMLCanvasElement;
      void canvas;
      return (window as unknown as { __flView?: (x: number, y: number) => { x: number; y: number } }).__flView?.(dx, dy) ?? null;
    },
    [x, y],
  );
  if (!p) throw new Error('no view hook');
  return { x: box.x + p.x, y: box.y + p.y };
}

/** Drag through project-space points with the mouse. */
export async function drawDoc(page: Page, pts: [number, number][]): Promise<void> {
  const c = await Promise.all(pts.map(([x, y]) => docToClient(page, x, y)));
  await page.mouse.move(c[0].x, c[0].y);
  await page.mouse.down();
  for (const q of c.slice(1)) await page.mouse.move(q.x, q.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(50);
}

export async function tapDoc(page: Page, x: number, y: number): Promise<void> {
  const q = await docToClient(page, x, y);
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(80);
}

export async function pixel(page: Page, x: number, y: number, frame?: number): Promise<number[]> {
  return page.evaluate(([px, py, f]) => (window as unknown as { __fl: { pixel: (a: number, b: number, c?: number) => Promise<number[]> } }).__fl.pixel(px, py, f ?? undefined), [x, y, frame ?? null] as const);
}

export async function inked(page: Page, frame?: number): Promise<number> {
  return page.evaluate((f) => (window as unknown as { __fl: { inked: (f?: number) => Promise<number> } }).__fl.inked(f ?? undefined), frame ?? null);
}

export async function sessionEval<T>(page: Page, code: string): Promise<T> {
  // Evaluated through the DevTools protocol, so it works under the app's strict CSP (no eval in the page).
  return page.evaluate(`(function (s) { return (${code}); })(window.__fl.session())`) as Promise<T>;
}

export async function frameCount(page: Page): Promise<number> {
  return sessionEval<number>(page, 's.doc.frames.length');
}

export async function selectTool(page: Page, id: string): Promise<void> {
  await page.click(`[data-testid=tool-${id}]`);
}

export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.locator('.toast').filter({ hasText: text }).first()).toBeVisible();
}

/** Tiny PNG made in the browser (solid colour). */
export async function makePng(page: Page, w: number, h: number, color: string): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([W, H, C]) => {
      const c = document.createElement('canvas');
      c.width = W as number;
      c.height = H as number;
      const x = c.getContext('2d')!;
      x.fillStyle = C as string;
      x.fillRect(0, 0, W as number, H as number);
      return c.toDataURL('image/png').split(',')[1];
    },
    [w, h, color] as const,
  );
  return Buffer.from(b64, 'base64');
}

/** 1 s mono 440 Hz WAV. */
export function makeWav(seconds = 1, rate = 22050): Buffer {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), 44 + i * 2);
  return buf;
}
