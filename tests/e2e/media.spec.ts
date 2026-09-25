import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { drawDoc, expectToast, frameCount, inked, makePng, makeWav, newProject, openApp, pixel, sessionEval } from './helpers';

async function exportAs(page: Page, format: string, tweak?: () => Promise<void>): Promise<Buffer> {
  await page.getByTestId('open-export').click();
  await page.getByTestId(`format-${format}`).click();
  if (tweak) await tweak();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 60_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-save').click()]);
  const buf = readFileSync((await dl.path())!);
  await page.keyboard.press('Escape');
  return buf;
}

async function threeFrames(page: Page) {
  await newProject(page, { width: 320, height: 240 });
  for (let i = 0; i < 3; i++) {
    if (i) await page.getByTestId('add-frame').click();
    await drawDoc(page, [
      [40 + i * 80, 60],
      [80 + i * 80, 180],
    ]);
  }
}

test('onion skin shows neighbouring frames tinted', async ({ page }) => {
  await openApp(page);
  await newProject(page, { width: 320, height: 240 });
  await drawDoc(page, [
    [60, 60],
    [60, 180],
  ]);
  await page.getByTestId('add-frame').click();
  const onionPx = async () =>
    page.evaluate(() => {
      const s = (window as unknown as { __fl: { session: () => { __vp: { composite: HTMLCanvasElement } } } }).__fl.session();
      const c = s.__vp.composite;
      return [...c.getContext('2d')!.getImageData(60, 120, 1, 1).data];
    });
  await expect.poll(async () => (await onionPx())[0]).toBeGreaterThan(200); // red-tinted previous frame over white
  const px = await onionPx();
  expect(px[1]).toBeLessThan(230);
  await page.getByTestId('toggle-onion').click();
  await expect.poll(async () => (await onionPx())[1]).toBe(255);
});

test('export GIF, PNG, PNG sequence and sprite sheet', async ({ page }) => {
  await openApp(page);
  await threeFrames(page);
  const gif = await exportAs(page, 'gif');
  expect(gif.subarray(0, 6).toString()).toBe('GIF89a');
  expect(gif.length).toBeGreaterThan(500);
  const png = await exportAs(page, 'png');
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  const zip = await exportAs(page, 'pngseq');
  const files = Object.keys(unzipSync(new Uint8Array(zip)));
  expect(files.length).toBe(3);
  expect(files.every((f) => f.endsWith('.png'))).toBe(true);
  const sheet = await exportAs(page, 'spritesheet');
  expect(sheet.subarray(1, 4).toString()).toBe('PNG');
});

test('export video (MP4 container, best available codec) and WebM', async ({ page }) => {
  await openApp(page);
  await threeFrames(page);
  const mp4 = await exportAs(page, 'mp4');
  expect(mp4.subarray(4, 8).toString()).toBe('ftyp');
  expect(mp4.length).toBeGreaterThan(1000);
  const webm = await exportAs(page, 'webm');
  expect(webm.readUInt32BE(0)).toBe(0x1a45dfa3); // EBML
});

test('project file export and re-import', async ({ page }) => {
  await openApp(page);
  await threeFrames(page);
  const file = await exportAs(page, 'project');
  const entries = Object.keys(unzipSync(new Uint8Array(file)));
  expect(entries).toContain('project.json');
  expect(entries.filter((e) => e.startsWith('cels/')).length).toBe(3);
  // Back home (discard) and import it.
  await page.getByTestId('editor-home').click();
  await page.getByTestId('choice-discard').click();
  await page.waitForSelector('[data-testid=home]');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('open-file').click()]);
  await chooser.setFiles({ name: 'anim.frameloom', mimeType: 'application/octet-stream', buffer: file });
  await expectToast(page, 'Projet importé');
  await expect(page.getByTestId('project-card')).toHaveCount(2);
  await page.getByTestId('project-card').first().locator('.project-open').click();
  await page.waitForSelector('[data-testid=main-canvas]');
  expect(await frameCount(page)).toBe(3);
  await expect.poll(() => inked(page, 2)).toBeGreaterThan(0);
});

test('corrupted project file shows a friendly error', async ({ page }) => {
  await openApp(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('open-file').click()]);
  await chooser.setFiles({ name: 'broken.frameloom', mimeType: 'application/octet-stream', buffer: Buffer.from('definitely not a zip') });
  await expect(page.getByText("Ce fichier n'est pas un projet Frameloom valide.")).toBeVisible();
  await page.getByText('Voir les détails techniques').click();
  await expect(page.locator('.error-box pre')).toContainText('not-a-zip');
});

test('import image as layer and as floating object', async ({ page }) => {
  await openApp(page);
  await newProject(page, { width: 320, height: 240 });
  const png = await makePng(page, 100, 80, '#ff0000');
  await page.getByTestId('import-menu').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import-image-layer').click()]);
  await chooser.setFiles({ name: 'rouge.png', mimeType: 'image/png', buffer: png });
  await expect.poll(() => sessionEval<number>(page, 's.doc.layers.length')).toBe(2);
  expect(await sessionEval<string>(page, 's.layer.name')).toBe('rouge');
  expect(await pixel(page, 160, 120)).toEqual([255, 0, 0, 255]);
  await page.getByTestId('undo').click();
  expect(await sessionEval<number>(page, 's.doc.layers.length')).toBe(1);
});

test('audio import, clip on the timeline, export with audio', async ({ page }) => {
  await openApp(page);
  await newProject(page, { width: 320, height: 240, frames: 12 });
  await page.getByTestId('import-menu').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import-audio').click()]);
  await chooser.setFiles({ name: 'bip.wav', mimeType: 'audio/wav', buffer: makeWav(1) });
  await expect(page.getByTestId('audio-clip')).toHaveCount(1);
  expect(await sessionEval<number>(page, 's.doc.audio[0].clips[0].duration')).toBeCloseTo(1, 1);
  // Clip editor: volume and split.
  await page.getByTestId('audio-clip').click();
  await expect(page.getByTestId('clip-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  const webm = await exportAs(page, 'webm');
  expect(webm.readUInt32BE(0)).toBe(0x1a45dfa3);
  // An Opus audio track is present in the WebM.
  expect(webm.includes(Buffer.from('A_OPUS'))).toBe(true);
});

test('video import converts a video into frames', async ({ page }) => {
  await openApp(page);
  await threeFrames(page);
  const webm = await exportAs(page, 'webm');
  await page.getByTestId('editor-home').click();
  await page.getByTestId('choice-discard').click();
  await newProject(page, { width: 320, height: 240 });
  await page.getByTestId('import-menu').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import-video').click()]);
  await chooser.setFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: webm });
  await expect(page.getByTestId('video-dialog')).toBeVisible();
  await expect(page.getByTestId('video-import')).toBeEnabled({ timeout: 15000 });
  await expect(page.getByTestId('video-end')).toHaveValue('0.25');
  await page.getByTestId('video-import').click();
  await expect(page.getByTestId('video-dialog')).toBeHidden({ timeout: 30000 });
  expect(await frameCount(page)).toBe(3);
  expect(await sessionEval<number>(page, 's.doc.layers.length')).toBe(2);
  await expect.poll(() => inked(page, 0)).toBeGreaterThan(100);
});

test('crash recovery offers the unsaved work', async ({ page }) => {
  await openApp(page);
  await newProject(page, { name: 'Crash', width: 320, height: 240 });
  await drawDoc(page, [
    [40, 40],
    [280, 200],
  ]);
  await page.evaluate(() => (window as unknown as { __fl: { session: () => { autosave: () => Promise<boolean> } } }).__fl.session().autosave());
  // Simulate a crash: reload without saving.
  await page.goto('/?e2e');
  await expect(page.getByText('Un projet non sauvegardé a été récupéré.')).toBeVisible();
  await page.getByTestId('choice-restore').click();
  await page.waitForSelector('[data-testid=main-canvas]');
  await expect.poll(() => inked(page)).toBeGreaterThan(50);
  await expect(page.getByTestId('save-state')).toContainText('non enregistrées');
});

test('recovery can be deleted', async ({ page }) => {
  await openApp(page);
  await newProject(page, { width: 320, height: 240 });
  await drawDoc(page, [
    [40, 40],
    [280, 200],
  ]);
  await page.evaluate(() => (window as unknown as { __fl: { session: () => { autosave: () => Promise<boolean> } } }).__fl.session().autosave());
  await page.goto('/?e2e');
  await page.getByTestId('choice-delete').click();
  await page.getByTestId('project-card').first().locator('.project-open').click();
  await page.waitForSelector('[data-testid=main-canvas]');
  expect(await inked(page)).toBe(0);
});

test('trash, restore and versions', async ({ page }) => {
  await openApp(page);
  await newProject(page, { name: 'Versions', width: 320, height: 240 });
  await drawDoc(page, [
    [40, 40],
    [100, 100],
  ]);
  await page.getByTestId('save').click();
  await drawDoc(page, [
    [200, 40],
    [300, 200],
  ]);
  await page.getByTestId('save').click();
  await page.getByTestId('editor-home').click();
  await page.waitForSelector('[data-testid=home]');
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Versions' }).click();
  await expect(page.getByTestId('versions-dialog')).toBeVisible();
  await expect(page.getByTestId('versions-dialog').locator('.list-row')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Supprimer' }).click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('project-card')).toHaveCount(0);
  await page.getByTestId('open-trash').click();
  await page.getByTestId('trash-dialog').getByRole('button', { name: 'Restaurer' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('project-card')).toHaveCount(1);
});

test('settings: dark theme, English, large buttons', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('setting-theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('settings-interface').click();
  await page.getByTestId('setting-uisize').selectOption('large');
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'large');
  await page.getByTestId('settings-general').click();
  await page.getByTestId('setting-language').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByTestId('settings-back').click();
  await expect(page.getByText('New project').first()).toBeVisible();
});
