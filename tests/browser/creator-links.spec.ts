import { expect, test } from '@playwright/test';
import { installAppHarness } from './harness';
import { clearSdkCalls, expectCurrentTrack, latestInstance, openCatalog, providerCalls } from './test-helpers';

const creatorLinks = [
  { name: 'Follow Bill on Twitter', text: 'Twitter', href: 'https://x.com/billdifferen' },
  { name: 'Support Bill on Ko-fi', text: 'Support Bill', href: 'https://ko-fi.com/billdifferen' },
];

test('keeps Bill’s follow and support links visible in desktop and mobile headers', async ({ page }) => {
  await installAppHarness(page);
  await openCatalog(page);
  const header = page.getByRole('banner');
  const navigation = header.getByRole('navigation', { name: 'Follow and support Bill' });

  for (const width of [1440, 1250, 1200, 1100, 901, 900, 768, 701, 700, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('link')).toHaveCount(2);
    const headerBounds = (await header.boundingBox())!;
    for (const { name, text, href } of creatorLinks) {
      const link = navigation.getByRole('link', { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveText(text);
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      const linkBounds = (await link.boundingBox())!;
      expect(linkBounds.x).toBeGreaterThanOrEqual(0);
      expect(linkBounds.x + linkBounds.width).toBeLessThanOrEqual(width);
      expect(linkBounds.y).toBeGreaterThanOrEqual(headerBounds.y);
      expect(linkBounds.y + linkBounds.height).toBeLessThanOrEqual(headerBounds.y + headerBounds.height);
      expect(await link.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    const brandBounds = (await header.locator('.brand-name').boundingBox())!;
    const actionBounds = (await header.locator('.topbar-actions').boundingBox())!;
    const navigationBounds = (await navigation.boundingBox())!;
    expect(brandBounds.x + brandBounds.width).toBeLessThanOrEqual(actionBounds.x);
    if (width > 700) {
      expect(actionBounds.x + actionBounds.width).toBeLessThanOrEqual(navigationBounds.x);
    } else {
      expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(navigationBounds.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  const supportLink = navigation.getByRole('link', { name: 'Support Bill on Ko-fi', exact: true });
  await supportLink.hover();
  await expect(supportLink).toHaveCSS('color', 'rgb(8, 8, 9)');
});

for (const width of [1440, 390]) {
  test(`opens creator links separately without interrupting playback at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await installAppHarness(page);
    for (const { href } of creatorLinks) {
      await context.route(href, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Creator destination</title>',
      }));
    }
    await openCatalog(page);
    await page.getByRole('button', { name: 'Play playback', exact: true }).click();
    const activeInstance = await latestInstance(page, 'youtube');
    const playlistUrl = page.url();
    await clearSdkCalls(page);

    for (const { name, href } of creatorLinks) {
      const popupPromise = page.waitForEvent('popup');
      await page.getByRole('link', { name, exact: true }).click();
      const popup = await popupPromise;
      await expect(popup).toHaveURL(href);
      expect(await popup.evaluate(() => window.opener)).toBeNull();
      await popup.close();
      await expect(page).toHaveURL(playlistUrl);
      await expectCurrentTrack(page, 'Sunrise Relay');
      expect((await latestInstance(page, 'youtube'))?.instanceId).toBe(activeInstance?.instanceId);
      expect((await latestInstance(page, 'youtube'))?.playing).toBe(true);
    }
    expect(await providerCalls(page, 'youtube', ['destroy', 'pauseVideo'])).toHaveLength(0);
  });
}
