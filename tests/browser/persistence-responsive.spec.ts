import { expect, test } from '@playwright/test';
import { installAppHarness } from './harness';
import {
  clearSdkCalls,
  expectCurrentTrack,
  latestInstance,
  openCatalog,
  providerCalls,
  setProviderProgress,
} from './test-helpers';

test('uses provider seek and volume units and restores a saved session paused', async ({ page }) => {
  const persistedPlayback = JSON.stringify({
    version: 1,
    playlistId: 'july-2026',
    trackId: 'soundcloud-river',
    order: 'reverse',
    volume: 0.42,
    progress: 18,
  });
  await installAppHarness(page, {
    localStorage: { 'pilldiff.playback.v1': persistedPlayback },
  });
  await openCatalog(page);

  await expectCurrentTrack(page, 'River Signal');
  await expect(page.getByLabel('Now playing source').getByText('paused', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play playback' })).toBeVisible();
  expect((await latestInstance(page, 'soundcloud'))?.playing).toBe(false);

  const restoredCalls = await providerCalls(page, 'soundcloud');
  expect(restoredCalls.some((call) => call.method === 'setVolume' && call.arguments[0] === 42)).toBe(true);
  expect(restoredCalls.some((call) => call.method === 'seekTo' && call.arguments[0] === 18_000)).toBe(true);
  expect(restoredCalls.some((call) => call.method === 'play')).toBe(false);
});

test('sends seconds to YouTube seek and normalized volume as provider percentages', async ({ page }) => {
  await installAppHarness(page);
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play playback' }).click();
  await setProviderProgress(page, 'youtube', 60, 240);
  await expect(page.getByLabel('Playback controls').getByText('1:00', { exact: true })).toBeVisible();
  await clearSdkCalls(page);

  await page.getByRole('slider', { name: 'Seek' }).fill('120');
  await page.getByRole('slider', { name: 'Volume' }).fill('0.35');

  const youtubeCalls = await providerCalls(page, 'youtube');
  expect(youtubeCalls.some(
    (call) => call.method === 'seekTo' && call.arguments[0] === 120 && call.arguments[1] === true,
  )).toBe(true);
  expect(youtubeCalls.some(
    (call) => call.method === 'setVolume' && call.arguments[0] === 35,
  )).toBe(true);
});

test('fits desktop and narrow viewports while mobile archive browsing preserves the player', async ({ page }) => {
  await installAppHarness(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play playback' }).click();
  const activeInstance = await latestInstance(page, 'youtube');

  for (const viewportWidth of [1440, 390, 320]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    await expect.poll(async () => page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }))).toEqual({ documentWidth: viewportWidth, viewportWidth });
    const playerBox = await page.locator('iframe[title="YouTube player"]').boundingBox();
    expect(playerBox?.width).toBeGreaterThanOrEqual(200);
    expect(playerBox?.height).toBeGreaterThanOrEqual(200);
  }

  await clearSdkCalls(page);
  await page.getByRole('button', { name: 'Open playlist archive' }).click();
  const archive = page.getByRole('complementary', { name: 'Playlist archive' });
  await expect(archive).toBeVisible();
  await page.getByPlaceholder('Search playlists or tracks').fill('Cloud Sequence');
  await expect(archive.getByText('1 playlist', { exact: true })).toBeVisible();
  await archive.getByRole('button', { name: /^Collections 2025/ }).click();
  await expect(page.getByRole('heading', { name: 'Collections 2025 — Long Players' })).toBeVisible();

  expect((await latestInstance(page, 'youtube'))?.instanceId).toBe(activeInstance?.instanceId);
  expect((await latestInstance(page, 'youtube'))?.playing).toBe(true);
  expect(await providerCalls(page, 'youtube', ['destroy', 'pauseVideo'])).toHaveLength(0);
  await expectCurrentTrack(page, 'Sunrise Relay');
});
