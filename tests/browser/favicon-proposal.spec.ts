import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const proposalPath = '/proposals/favicons/index.html';
const concepts = [
  { id: 'blackletter', name: 'Blackletter B', asset: '01-blackletter.svg', download: 'pilldiff-blackletter.svg' },
  { id: 'capsule', name: 'Play capsule', asset: '02-play-capsule.svg', download: 'pilldiff-play-capsule.svg' },
  { id: 'flower', name: 'Record flower', asset: '03-record-flower.svg', download: 'pilldiff-record-flower.svg' },
  { id: 'mixtape', name: 'Little mixtape', asset: '04-little-mixtape.svg', download: 'pilldiff-little-mixtape.svg' },
  { id: 'offbeat', name: 'Offbeat', asset: '05-offbeat.svg', download: 'pilldiff-offbeat.svg' },
];

test('renders five standalone SVG concepts at their labeled pixel sizes', async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(proposalPath);
  await expect(page).toHaveTitle('Five favicon directions · pilldiff');
  await expect(page.getByRole('article')).toHaveCount(5);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');

  for (const concept of concepts) {
    const card = page.getByRole('article', { name: concept.name, exact: true });
    await expect(card.getByRole('heading', { name: concept.name, exact: true })).toBeVisible();
    for (const size of [16, 32, 48]) {
      const icon = card.locator(`img[data-size="${size}"]`);
      await expect(icon).toHaveCSS('width', `${size}px`);
      await expect(icon).toHaveCSS('height', `${size}px`);
    }

    const response = await request.get(`/proposals/favicons/${concept.asset}`);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
    const svg = await response.text();
    expect(Buffer.byteLength(svg)).toBeLessThan(2048);
    const structure = await page.evaluate((source) => {
      const document = new DOMParser().parseFromString(source, 'image/svg+xml');
      return {
        root: document.documentElement.localName,
        viewBox: document.documentElement.getAttribute('viewBox'),
        errors: document.querySelectorAll('parsererror').length,
        dependencies: document.querySelectorAll('script, image, foreignObject, use, text, style, [href]').length,
      };
    }, svg);
    expect(structure).toEqual({ root: 'svg', viewBox: '0 0 64 64', errors: 0, dependencies: 0 });
  }

  await expect.poll(() => page.locator('img').evaluateAll((images) => images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(await (await request.get('/')).text()).not.toContain('/proposals/favicons/');
});

test('previews, switches, and clears only the proposal tab favicon', async ({ page }) => {
  await page.goto(proposalPath);
  const favicon = page.locator('#proposal-favicon');
  const initialIcon = await favicon.getAttribute('href');
  const reset = page.getByRole('button', { name: 'Clear preview', exact: true });
  await expect(reset).toBeDisabled();

  for (const concept of concepts) {
    const button = page.locator(`#${concept.id} .try-button`);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(favicon).toHaveAttribute('href', `./${concept.asset}`);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-preview][aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByRole('status')).toHaveText(`${concept.name} is in this tab. The player is unchanged.`);
    await expect(reset).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`${proposalPath}$`));
  }

  await reset.click();
  await expect(favicon).toHaveAttribute('href', initialIcon!);
  await expect(page.locator('[data-preview][aria-pressed="true"]')).toHaveCount(0);
  await expect(reset).toBeDisabled();
  await expect(page.locator('#offbeat .try-button')).toBeFocused();

  const toggle = page.locator('#blackletter .try-button');
  await toggle.click();
  await toggle.click();
  await expect(favicon).toHaveAttribute('href', initialIcon!);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('switches artboard backgrounds independently of the favicon', async ({ page }) => {
  await page.goto(proposalPath);
  const favicon = await page.locator('#proposal-favicon').getAttribute('href');
  for (const [theme, color] of [['Paper', 'rgb(234, 230, 222)'], ['Ink', 'rgb(27, 27, 30)']]) {
    const button = page.getByRole('button', { name: theme, exact: true });
    await button.focus();
    await page.keyboard.press('Space');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-artboard-theme][aria-pressed="true"]')).toHaveCount(1);
    for (const concept of concepts) {
      await expect(page.locator(`#${concept.id} .artboard`)).toHaveCSS('background-color', color);
      await expect(page.locator(`#${concept.id} .size-proof`)).toHaveCSS('background-color', color);
    }
    await expect(page.locator('#proposal-favicon')).toHaveAttribute('href', favicon!);
  }
});

test('jump links reveal each concept and downloads contain its original SVG', async ({ page, request }) => {
  await page.goto(proposalPath);
  const navigation = page.getByRole('navigation', { name: 'Favicon concepts' });

  for (const concept of concepts) {
    await navigation.getByRole('link', { name: new RegExp(concept.name) }).click();
    await expect(page).toHaveURL(new RegExp(`#${concept.id}$`));
    await expect(page.getByRole('heading', { name: concept.name, exact: true })).toBeInViewport();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: `Download ${concept.name} SVG`, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(concept.download);
    expect(await download.failure()).toBeNull();
    const original = await request.get(`/proposals/favicons/${concept.asset}`);
    expect(await readFile((await download.path())!, 'utf8')).toBe(await original.text());
  }
});

test('keeps titles, actual-size icons, and active preview controls inside narrow layouts', async ({ page }) => {
  await page.goto(proposalPath);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#blackletter .try-button').click();

  for (const width of [1440, 1100, 900, 768, 740, 600, 440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    for (const concept of concepts) {
      const card = page.locator(`#${concept.id}`);
      const bounds = (await card.boundingBox())!;
      for (const element of await card.locator('h3, .concept-actions > *, [data-size]').all()) {
        const elementBounds = (await element.boundingBox())!;
        expect(elementBounds.x).toBeGreaterThanOrEqual(bounds.x);
        expect(elementBounds.x + elementBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
    }
  }
});

test('keeps the full proposal and SVG downloads usable without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    await page.goto(proposalPath);
    await expect(page.getByRole('article')).toHaveCount(5);
    await expect(page.getByRole('button', { name: 'Try in this tab', exact: true })).toHaveCount(0);
    await expect(page.locator('.noscript-note')).toBeVisible();
    for (const concept of concepts) {
      await expect(page.getByRole('heading', { name: concept.name, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: `Download ${concept.name} SVG`, exact: true })).toBeVisible();
    }
  } finally {
    await context.close();
  }
});
