import { expect, test } from '@playwright/test';
import { drawDoc, expectToast, frameCount, inked, newProject, openApp, pixel, selectTool, sessionEval, tapDoc } from './helpers';

test.describe('project lifecycle', () => {
  test('create, draw, save, reload and reopen', async ({ page }) => {
    await openApp(page);
    await newProject(page, { name: 'Balle', width: 640, height: 360 });
    await drawDoc(page, [
      [100, 100],
      [200, 150],
      [300, 120],
    ]);
    expect(await inked(page)).toBeGreaterThan(50);
    await expect(page.getByTestId('save-state')).toContainText('non enregistrées');
    await page.getByTestId('save').click();
    await expectToast(page, 'Projet enregistré');
    await expect(page.getByTestId('save-state')).toContainText('Enregistré');

    await page.reload();
    await page.waitForSelector('[data-testid=home]');
    const card = page.getByTestId('project-card').first();
    await expect(card).toContainText('Balle');
    await expect(card).toContainText('640×360');
    await expect(card).toContainText('1 images');
    await card.locator('.project-open').click();
    await page.waitForSelector('[data-testid=main-canvas]');
    await expect.poll(() => inked(page)).toBeGreaterThan(50);
  });

  test('unsaved changes prompt when leaving the editor', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await drawDoc(page, [
      [200, 200],
      [400, 300],
    ]);
    await page.getByTestId('editor-home').click();
    await expect(page.getByTestId('choice-dialog')).toBeVisible();
    await page.getByTestId('choice-cancel').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await page.getByTestId('editor-home').click();
    await page.getByTestId('choice-save').click();
    await page.waitForSelector('[data-testid=home]');
    await expect(page.getByTestId('project-card')).toHaveCount(1);
  });
});

test.describe('frames & timeline', () => {
  test('add, duplicate, move, hold, delete with undo/redo', async ({ page }) => {
    await openApp(page);
    await newProject(page, { width: 400, height: 300 });
    await drawDoc(page, [
      [50, 50],
      [150, 150],
    ]);
    await page.getByTestId('add-frame').click();
    expect(await frameCount(page)).toBe(2);
    await expect(page.getByTestId('frame-counter')).toContainText('Image 2 / 2');
    expect(await inked(page)).toBe(0);
    await page.getByTestId('prev-frame').click();
    await page.getByTestId('duplicate-frame').click();
    expect(await frameCount(page)).toBe(3);
    expect(await inked(page, 1)).toBeGreaterThan(0);
    // Cels are independent after duplication.
    await drawDoc(page, [
      [300, 50],
      [350, 250],
    ]);
    expect(await inked(page, 1)).toBeGreaterThan(await inked(page, 0));
    await page.getByTestId('hold-plus').click();
    await page.getByTestId('hold-plus').click();
    await expect(page.getByTestId('hold-value')).toContainText('3');
    // Quick successive changes are merged into one undo step.
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('hold-value')).toContainText('1');
    await page.getByTestId('delete-frame').click();
    expect(await frameCount(page)).toBe(2);
    await page.getByTestId('undo').click();
    expect(await frameCount(page)).toBe(3);
    await page.getByTestId('redo').click();
    expect(await frameCount(page)).toBe(2);
    // Keyboard navigation
    await page.keyboard.press('Home');
    await expect(page.getByTestId('frame-counter')).toContainText('Image 1 / 2');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('frame-counter')).toContainText('Image 2 / 2');
  });

  test('multi-select, copy/paste and delete several frames', async ({ page }) => {
    await openApp(page);
    await newProject(page, { width: 320, height: 240, frames: 4 });
    for (let i = 0; i < 4; i++) {
      await drawDoc(page, [
        [20 + i * 60, 40],
        [40 + i * 60, 200],
      ]);
      if (i < 3) await page.getByTestId('next-frame').click();
    }
    const cells = page.getByTestId('frame-cell');
    await cells.nth(0).click();
    await cells.nth(1).click({ modifiers: ['Shift'] });
    expect(await sessionEval<number>(page, 's.frameSelection.size')).toBe(2);
    await page.getByTestId('copy-frames').click();
    await cells.nth(3).click();
    await page.getByTestId('paste-frames').click();
    expect(await frameCount(page)).toBe(6);
    expect(await inked(page, 4)).toBe(await inked(page, 0));
    await cells.nth(4).click();
    await cells.nth(5).click({ modifiers: ['Shift'] });
    await page.getByTestId('delete-frame').click();
    await page.getByTestId('confirm-ok').click();
    expect(await frameCount(page)).toBe(4);
  });

  test('handles a project with hundreds of frames (virtualised timeline)', async ({ page }) => {
    await openApp(page);
    await newProject(page, { width: 320, height: 240, frames: 400 });
    expect(await frameCount(page)).toBe(400);
    const rendered = await page.getByTestId('frame-cell').count();
    expect(rendered).toBeLessThan(80);
    await page.keyboard.press('End');
    await expect(page.getByTestId('frame-counter')).toContainText('Image 400 / 400');
    await drawDoc(page, [
      [60, 120],
      [300, 200],
    ]);
    expect(await inked(page, 399)).toBeGreaterThan(0);
    expect(await inked(page, 0)).toBe(0);
  });

  test('playback advances frames then pauses', async ({ page }) => {
    await openApp(page);
    await newProject(page, { width: 320, height: 240, frames: 12 });
    await page.getByTestId('play').click();
    await page.waitForTimeout(600);
    const during = await sessionEval<number>(page, 's.frameIndex');
    expect(during).toBeGreaterThan(0);
    await page.getByTestId('play').click();
    const a = await sessionEval<number>(page, 's.frameIndex');
    await page.waitForTimeout(300);
    expect(await sessionEval<number>(page, 's.frameIndex')).toBe(a);
    await page.getByTestId('stop').click();
    await expect(page.getByTestId('frame-counter')).toContainText('Image 1 / 12');
  });
});

test.describe('layers', () => {
  test('add, lock, hide, opacity, blend, merge, delete', async ({ page }) => {
    await openApp(page);
    await newProject(page, { width: 400, height: 300 });
    await drawDoc(page, [
      [50, 150],
      [350, 150],
    ]);
    await page.getByTestId('add-layer').click();
    expect(await sessionEval<number>(page, 's.doc.layers.length')).toBe(2);
    await drawDoc(page, [
      [200, 20],
      [200, 280],
    ]);
    // Lock the active layer: drawing is refused.
    await page.getByTestId('layer-row').first().getByTestId('layer-lock').click();
    const before = await inked(page);
    await drawDoc(page, [
      [20, 20],
      [380, 280],
    ]);
    await expectToast(page, 'verrouillé');
    expect(await inked(page)).toBe(before);
    await page.getByTestId('layer-row').first().getByTestId('layer-lock').click();
    // Hide: the vertical line disappears from the composite.
    await page.getByTestId('layer-row').first().getByTestId('layer-visibility').click();
    expect((await pixel(page, 200, 60))[3]).toBe(0);
    await page.getByTestId('layer-row').first().getByTestId('layer-visibility').click();
    expect((await pixel(page, 200, 60))[3]).toBeGreaterThan(0);
    // Opacity and blend mode
    await page.getByTestId('layer-opacity').fill('0.5');
    expect(await sessionEval<number>(page, 's.layer.opacity')).toBeCloseTo(0.5, 1);
    await page.getByTestId('layer-blend').selectOption('multiply');
    expect(await sessionEval<string>(page, 's.layer.blendMode')).toBe('multiply');
    // Merge down
    await page.getByTestId('merge-layer').click();
    await expect.poll(() => sessionEval<number>(page, 's.doc.layers.length')).toBe(1);
    expect((await pixel(page, 200, 60))[3]).toBeGreaterThan(0);
    expect((await pixel(page, 60, 150))[3]).toBeGreaterThan(0);
    await page.getByTestId('undo').click();
    expect(await sessionEval<number>(page, 's.doc.layers.length')).toBe(2);
    await page.getByTestId('duplicate-layer').click();
    expect(await sessionEval<number>(page, 's.doc.layers.length')).toBe(3);
    await page.getByTestId('delete-layer').click();
    await page.getByTestId('confirm-ok').click();
    expect(await sessionEval<number>(page, 's.doc.layers.length')).toBe(2);
  });
});

test.describe('drawing tools', () => {
  test('eraser, shapes, fill, eyedropper, undo', async ({ page }) => {
    await openApp(page);
    await newProject(page, { width: 400, height: 300 });
    // Rectangle outline
    await selectTool(page, 'shape');
    await drawDoc(page, [
      [100, 100],
      [300, 200],
    ]);
    expect((await pixel(page, 100, 150))[3]).toBeGreaterThan(0);
    expect((await pixel(page, 200, 150))[3]).toBe(0);
    // Fill inside with the primary colour
    await page.evaluate(() => (window as unknown as { __fl: { session: () => unknown } }).__fl);
    await selectTool(page, 'fill');
    await tapDoc(page, 200, 150);
    expect((await pixel(page, 200, 150))[3]).toBe(255);
    // Eyedropper picks the fill colour
    await selectTool(page, 'eyedropper');
    await tapDoc(page, 200, 150);
    // Eraser removes pixels
    await selectTool(page, 'eraser');
    await drawDoc(page, [
      [150, 150],
      [250, 150],
    ]);
    expect((await pixel(page, 200, 150))[3]).toBe(0);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await pixel(page, 200, 150))[3]).toBe(255);
    await page.keyboard.press('Control+y');
    await expect.poll(async () => (await pixel(page, 200, 150))[3]).toBe(0);
  });

  test('selection: delete, copy/paste, transform, move to layer', async ({ page }) => {
    await openApp(page);
    await newProject(page, { width: 400, height: 300 });
    await drawDoc(page, [
      [40, 40],
      [360, 40],
    ]);
    await drawDoc(page, [
      [40, 260],
      [360, 260],
    ]);
    await selectTool(page, 'select');
    await drawDoc(page, [
      [10, 10],
      [390, 100],
    ]);
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    await page.getByTestId('sel-copy').click();
    await page.getByTestId('sel-delete').click();
    expect((await pixel(page, 200, 40))[3]).toBe(0);
    expect((await pixel(page, 200, 260))[3]).toBeGreaterThan(0);
    await page.keyboard.press('Control+v');
    await expect(page.getByTestId('transform-bar')).toBeVisible();
    await page.getByTestId('transform-apply').click();
    await expect.poll(async () => (await pixel(page, 200, 40))[3]).toBeGreaterThan(0);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await pixel(page, 200, 40))[3]).toBe(0);
  });

  test('text tool creates rasterised text', async ({ page }) => {
    await openApp(page);
    await newProject(page, { width: 400, height: 300 });
    await selectTool(page, 'text');
    await tapDoc(page, 60, 150);
    await expect(page.getByTestId('transform-bar')).toBeVisible();
    await page.getByTestId('tab-tool').click();
    await page.getByTestId('text-content').fill('Bonjour');
    await page.getByTestId('text-apply').click();
    await expect.poll(() => inked(page)).toBeGreaterThan(30);
  });
});
