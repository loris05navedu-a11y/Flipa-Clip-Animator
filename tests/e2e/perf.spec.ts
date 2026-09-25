import { expect, test } from '@playwright/test';
import { inked, makePng, newProject, openApp, sessionEval } from './helpers';

test('heavy project: 40 Full HD frames stay within the memory budget', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page);
  await page.evaluate(() => localStorage.setItem('frameloom.settings', JSON.stringify({ state: { cacheBudgetMB: 128 }, version: 1 })));
  await page.reload();
  await page.waitForSelector('[data-testid=home]');
  await newProject(page, { width: 1920, height: 1080 });
  const files = [];
  for (let i = 0; i < 40; i++) files.push({ name: `seq_${String(i).padStart(3, '0')}.png`, mimeType: 'image/png', buffer: await makePng(page, 1920, 1080, `hsl(${i * 9},70%,50%)`) });
  await page.getByTestId('import-menu').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText("Séquence d'images (une image par frame)").click()]);
  await chooser.setFiles(files);
  await expect.poll(() => sessionEval<number>(page, 's.doc.frames.length'), { timeout: 120_000 }).toBe(40);
  await page.waitForTimeout(500);
  const mem = await sessionEval<number>(page, 's.cels.memoryBytes()');
  console.log('decoded memory after import (MB):', Math.round(mem / 1048576));
  expect(mem).toBeLessThan(160 * 1024 * 1024);
  // Every frame still renders (decoded on demand).
  await page.keyboard.press('End');
  await expect.poll(() => inked(page, 39)).toBeGreaterThan(1000);
  // Playback through the whole sequence.
  await page.keyboard.press('Home');
  await page.getByTestId('play').click();
  await expect.poll(() => sessionEval<number>(page, 's.frameIndex'), { timeout: 10_000 }).toBeGreaterThan(20);
  await page.getByTestId('play').click();
  const after = await sessionEval<number>(page, 's.cels.memoryBytes()');
  console.log('decoded memory after playback (MB):', Math.round(after / 1048576));
  expect(after).toBeLessThan(200 * 1024 * 1024);
  // Save works for a heavy project.
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-state')).toContainText('Enregistré', { timeout: 60_000 });
});
