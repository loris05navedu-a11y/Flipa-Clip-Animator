import { test } from '@playwright/test';
import { drawDoc, makeWav, newProject, openApp } from './helpers';
const DIR = '/tmp/claude-0/-home-user-Flipa-Clip-Animator/cd969eca-d08e-56c4-90f2-b2a65e50e83f/scratchpad/shots';
const sizes = { tabletL: { width: 1280, height: 800 }, tabletP: { width: 800, height: 1280 }, phoneP: { width: 390, height: 844 }, phoneL: { width: 844, height: 390 } };
for (const [name, vp] of Object.entries(sizes)) {
  test(`shots ${name}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await openApp(page);
    await page.evaluate(() => localStorage.setItem('frameloom.settings', JSON.stringify({ state: { theme: 'dark' }, version: 1 })));
    await page.reload();
    await page.waitForSelector('[data-testid=home]');
    await newProject(page, { width: 1280, height: 720, frames: 3 });
    await drawDoc(page, [[300, 300], [500, 200], [700, 400], [900, 250]]);
    await page.getByTestId('add-layer').click({ timeout: 1000 }).catch(() => undefined);
    if (await page.getByTestId('import-menu').isVisible()) await page.getByTestId('import-menu').click(); else await page.getByTestId('more-menu').click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import-audio').click()]);
    await chooser.setFiles({ name: 'musique.wav', mimeType: 'audio/wav', buffer: makeWav(1) });
    await page.waitForTimeout(500);
    await page.getByTestId('timeline-layers').click().catch(() => undefined);
    await page.screenshot({ path: `${DIR}/${name}-editor.png` });
    await page.getByTestId('primary-color').click();
    await page.screenshot({ path: `${DIR}/${name}-colors.png` });
    await page.getByTestId('open-export').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/${name}-export.png` });
  });
}
