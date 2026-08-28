import { expect, test } from '@playwright/test';
import { installAppHarness } from './harness';
import { sdkSnapshot } from './mock-sdks';
import {
  clearSdkCalls,
  expectCurrentTrack,
  finishProvider,
  latestInstance,
  openCatalog,
  providerCalls,
  selectPlaylist,
  setProviderProgress,
  waitForProviderPlaying,
} from './test-helpers';

test('cues the latest playlist paused without autoplay on initial load', async ({ page }) => {
  await installAppHarness(page);
  await openCatalog(page);

  await expectCurrentTrack(page, 'Sunrise Relay');
  await expect(page.getByLabel('Now playing source').getByText('paused', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play playback' })).toBeEnabled();

  const youtubeCalls = await providerCalls(page, 'youtube');
  expect(youtubeCalls.some((call) => call.method === 'cueVideoById')).toBe(true);
  expect(youtubeCalls.some((call) => ['loadVideoById', 'playVideo'].includes(call.method))).toBe(false);
});

test('hands off YouTube to SoundCloud to YouTube without overlapping providers', async ({ page }) => {
  await installAppHarness(page);
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play playback' }).click();
  await waitForProviderPlaying(page, 'youtube');
  await clearSdkCalls(page);

  await finishProvider(page, 'youtube');
  await expectCurrentTrack(page, 'River Signal');
  await waitForProviderPlaying(page, 'soundcloud');
  await expect.poll(async () => (await latestInstance(page, 'youtube'))?.playing).toBe(false);
  await expect(page.locator('.youtube-frame')).toBeHidden();
  await expect(page.locator('.soundcloud-frame')).toBeVisible();

  const firstHandoffCalls = (await sdkSnapshot(page)).calls;
  expect(firstHandoffCalls.some((call) => call.provider === 'youtube' && call.method === 'pauseVideo')).toBe(true);
  expect(firstHandoffCalls.some((call) => call.provider === 'soundcloud' && call.method === 'play')).toBe(true);

  await finishProvider(page, 'soundcloud');
  await expectCurrentTrack(page, 'Night Geometry');
  await waitForProviderPlaying(page, 'youtube');
  await expect.poll(async () => (await latestInstance(page, 'soundcloud'))?.playing).toBe(false);
  await expect(page.locator('.youtube-frame')).toBeVisible();
  await expect(page.locator('.soundcloud-frame')).toBeHidden();
});

test('starts the default playlist from its last displayed row when reversed before first play', async ({ page }) => {
  await installAppHarness(page);
  await openCatalog(page);

  await page.getByRole('button', { name: 'Reverse' }).click();
  await expect(page.locator('.track-list .track-copy strong')).toHaveText([
    'Static Orchard',
    'Night Geometry',
    'River Signal',
    'Sunrise Relay',
  ]);
  await page.locator('.playlist-actions .primary-button').click();
  await expectCurrentTrack(page, 'Static Orchard');
  await expect(page.getByLabel('Playback controls').getByText('1 of 4 · reverse')).toBeVisible();

  await page.getByRole('button', { name: 'Next track' }).click();
  await expectCurrentTrack(page, 'Night Geometry');
  await expect(page.getByLabel('Playback controls').getByText('2 of 4 · reverse')).toBeVisible();
});

test('changes order without reloading the current item or losing progress', async ({ page }) => {
  await installAppHarness(page);
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play playback' }).click();
  await setProviderProgress(page, 'youtube', 37, 240);
  await expect(page.getByLabel('Playback controls').getByText('0:37', { exact: true })).toBeVisible();
  await clearSdkCalls(page);

  await page.getByRole('button', { name: 'Reverse' }).click();
  await expectCurrentTrack(page, 'Sunrise Relay');
  await expect(page.getByLabel('Playback controls').getByText('0:37', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Playback controls').getByText('4 of 4 · reverse')).toBeVisible();

  const mediaCalls = await providerCalls(page, 'youtube', [
    'cueVideoById',
    'loadVideoById',
    'cuePlaylist',
    'loadPlaylist',
  ]);
  expect(mediaCalls).toHaveLength(0);
});

test('keeps active media playing while browsing and lets a row replace the queue', async ({ page }) => {
  await installAppHarness(page);
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play playback' }).click();
  const originalInstance = await latestInstance(page, 'youtube');
  await clearSdkCalls(page);

  await selectPlaylist(page, 'Collections 2025');
  await expect(page.getByRole('heading', { name: 'Collections 2025 — Long Players' })).toBeVisible();
  await expectCurrentTrack(page, 'Sunrise Relay');
  expect((await latestInstance(page, 'youtube'))?.instanceId).toBe(originalInstance?.instanceId);
  expect((await latestInstance(page, 'youtube'))?.playing).toBe(true);
  expect((await providerCalls(page, 'youtube', ['pauseVideo', 'destroy']))).toHaveLength(0);

  await page.getByRole('button', { name: 'Play Cloud Sequence' }).click();
  await expectCurrentTrack(page, 'Cloud Sequence');
  await expect(page.getByLabel('Playback controls').getByText('2 of 2 · blog order')).toBeVisible();
  await expect.poll(async () => (await latestInstance(page, 'youtube'))?.playing).toBe(false);
  await expect.poll(async () => (await latestInstance(page, 'soundcloud'))?.playing).toBe(true);
});

test('waits for the last internal item before advancing collection entries', async ({ page }) => {
  await installAppHarness(page);
  await openCatalog(page);
  await selectPlaylist(page, 'Collections 2025');
  await page.getByRole('button', { name: 'Play Video Constellation' }).click();
  await expectCurrentTrack(page, 'Video Constellation');
  await waitForProviderPlaying(page, 'youtube');

  await finishProvider(page, 'youtube');
  await expect.poll(async () => (await latestInstance(page, 'youtube'))?.collectionIndex).toBe(1);
  await waitForProviderPlaying(page, 'youtube');
  await expectCurrentTrack(page, 'Video Constellation');
  await finishProvider(page, 'youtube');
  await expect.poll(async () => (await latestInstance(page, 'youtube'))?.collectionIndex).toBe(2);
  await waitForProviderPlaying(page, 'youtube');
  await expectCurrentTrack(page, 'Video Constellation');
  await finishProvider(page, 'youtube');
  await expectCurrentTrack(page, 'Cloud Sequence');
  await waitForProviderPlaying(page, 'soundcloud');

  await finishProvider(page, 'soundcloud');
  await expect.poll(async () => (await latestInstance(page, 'soundcloud'))?.collectionIndex).toBe(1);
  await waitForProviderPlaying(page, 'soundcloud');
  await expectCurrentTrack(page, 'Cloud Sequence');
  await finishProvider(page, 'soundcloud');
  await expect.poll(async () => (await latestInstance(page, 'soundcloud'))?.collectionIndex).toBe(2);
  await waitForProviderPlaying(page, 'soundcloud');
  await expectCurrentTrack(page, 'Cloud Sequence');
  await finishProvider(page, 'soundcloud');
  await expect(page.getByLabel('Now playing source').getByText('ended', { exact: true })).toBeVisible();
});
