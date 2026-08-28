import { expect, test } from '@playwright/test';
import { browserCatalog } from './catalog-fixture';
import { installAppHarness } from './harness';
import {
  clearSdkCalls,
  expectCurrentTrack,
  failProvider,
  finishProvider,
  latestInstance,
  openCatalog,
  providerCalls,
  setProviderProgress,
  waitForProviderPlaying,
} from './test-helpers';

test('retries a blocked autoplay on the same item without skipping', async ({ page }) => {
  await installAppHarness(page, { sdk: { blockNextPlay: 'youtube' } });
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play playback' }).click();

  await expect(page.getByRole('button', { name: 'Continue playback' })).toBeVisible();
  await expectCurrentTrack(page, 'Sunrise Relay');
  await expect(page.getByLabel('Playback controls').getByText('1 of 4 · blog order')).toBeVisible();

  await page.getByRole('button', { name: 'Continue playback' }).click();
  await expect(page.getByRole('button', { name: 'Pause playback' })).toBeVisible();
  await expectCurrentTrack(page, 'Sunrise Relay');
  expect(await latestInstance(page, 'soundcloud')).toBeUndefined();
});

test('does not autoplay the next entry when the initial paused cue is unavailable', async ({ page }) => {
  await installAppHarness(page);
  await openCatalog(page);
  await failProvider(page, 'youtube', 100);

  await expectCurrentTrack(page, 'River Signal');
  await expect(page.getByLabel('Now playing source').getByText('paused', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play playback' })).toBeVisible();
  expect((await latestInstance(page, 'soundcloud'))?.playing).toBe(false);
  expect((await providerCalls(page, 'soundcloud', ['play']))).toHaveLength(0);
});

test('skips unavailable items forward once and stops at the queue boundary', async ({ page }) => {
  await installAppHarness(page);
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play playback' }).click();

  await failProvider(page, 'youtube', 100);
  await expectCurrentTrack(page, 'River Signal');
  await failProvider(page, 'soundcloud', 'not-found');
  await expectCurrentTrack(page, 'Night Geometry');
  await failProvider(page, 'youtube', 101);
  await expectCurrentTrack(page, 'Static Orchard');
  await failProvider(page, 'soundcloud', 'not-found');

  await expect(page.getByLabel('Now playing source').getByText('error', { exact: true })).toBeVisible();
  await expectCurrentTrack(page, 'Static Orchard');
  await page.waitForTimeout(100);
  const youtubeLoads = await providerCalls(page, 'youtube', ['loadVideoById']);
  const soundCloudLoads = await providerCalls(page, 'soundcloud', ['load']);
  expect(youtubeLoads).toHaveLength(1);
  expect(soundCloudLoads).toHaveLength(1);
});

test('ignores duplicate and inactive-provider completion events', async ({ page }) => {
  await installAppHarness(page);
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play playback' }).click();
  const youtubeInstance = await latestInstance(page, 'youtube');
  await waitForProviderPlaying(page, 'youtube');

  await finishProvider(page, 'youtube', 2, youtubeInstance?.instanceId);
  await expectCurrentTrack(page, 'River Signal');
  await page.waitForTimeout(100);
  await expectCurrentTrack(page, 'River Signal');

  await finishProvider(page, 'youtube', 1, youtubeInstance?.instanceId);
  await page.waitForTimeout(100);
  await expectCurrentTrack(page, 'River Signal');
  await finishProvider(page, 'soundcloud');
  await expectCurrentTrack(page, 'Night Geometry');
});

test('keeps a pause made while the next SDK is still becoming ready', async ({ page }) => {
  await installAppHarness(page, { sdk: { readyDelays: { soundcloud: 400 } } });
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play playback' }).click();
  await waitForProviderPlaying(page, 'youtube');
  await finishProvider(page, 'youtube');
  await expectCurrentTrack(page, 'River Signal');
  await expect(page.getByLabel('Now playing source').getByText('loading', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel pending playback' }).click();
  await page.waitForTimeout(450);
  await expect(page.getByLabel('Now playing source').getByText('paused', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play playback' })).toBeVisible();
  expect((await latestInstance(page, 'soundcloud'))?.playing).toBe(false);
});

test('checks the catalog without reloading or pausing active playback', async ({ page }) => {
  await installAppHarness(page, {
    updatedCatalog: {
      ...browserCatalog,
      fetchedAt: '2026-08-28T07:00:00.000Z',
    },
  });
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play playback' }).click();
  await setProviderProgress(page, 'youtube', 41, 240);
  await expect(page.getByLabel('Playback controls').getByText('0:41', { exact: true })).toBeVisible();
  const instanceBeforeCheck = await latestInstance(page, 'youtube');
  await clearSdkCalls(page);

  const updateResponse = page.waitForResponse(
    (response) => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/catalog.json'
      && new URL(response.url()).searchParams.has('check'),
  );
  await page.getByRole('button', { name: 'Check for playlist updates' }).click();
  await updateResponse;
  await expect(page.getByRole('button', { name: 'Check for playlist updates' })).toBeEnabled();

  await expectCurrentTrack(page, 'Sunrise Relay');
  await expect(page.getByRole('button', { name: 'Pause playback' })).toBeVisible();
  await expect(page.getByLabel('Playback controls').getByText('0:41', { exact: true })).toBeVisible();
  expect((await latestInstance(page, 'youtube'))?.instanceId).toBe(instanceBeforeCheck?.instanceId);
  expect((await latestInstance(page, 'youtube'))?.playing).toBe(true);
  expect(await providerCalls(page, 'youtube', [
    'cueVideoById',
    'loadVideoById',
    'destroy',
    'pauseVideo',
  ])).toHaveLength(0);
});

test('uses only static GET requests while checking for updates', async ({ page }) => {
  const catalogRequests: Array<{ method: string; url: string }> = [];
  page.on('request', (request) => {
    if (request.url().includes('/catalog') || request.url().includes('/api/')) {
      catalogRequests.push({ method: request.method(), url: request.url() });
    }
  });
  await installAppHarness(page);
  await openCatalog(page);

  const updateResponse = page.waitForResponse((response) => (
    new URL(response.url()).searchParams.has('check')
  ));
  await page.getByRole('button', { name: 'Check for playlist updates' }).click();
  await updateResponse;

  expect(catalogRequests.length).toBeGreaterThan(0);
  expect(catalogRequests.every((request) => (
    request.method === 'GET' && new URL(request.url).pathname === '/catalog.json'
  ))).toBe(true);
});

test('keeps the current archive and playback when an update check fails', async ({ page }) => {
  await installAppHarness(page, { updateStatus: 503 });
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play playback' }).click();
  await waitForProviderPlaying(page, 'youtube');
  const activeInstance = await latestInstance(page, 'youtube');

  await page.getByRole('button', { name: 'Check for playlist updates' }).click();

  await expect(page.locator('.catalog-warning')).toContainText('Couldn’t check the deployed snapshot.');
  await expect(page.getByRole('heading', { name: browserCatalog.playlists[0].title })).toBeVisible();
  await expectCurrentTrack(page, 'Sunrise Relay');
  expect((await latestInstance(page, 'youtube'))?.instanceId).toBe(activeInstance?.instanceId);
  expect((await latestInstance(page, 'youtube'))?.playing).toBe(true);
});

test('disables duplicate checks while a catalog request is in flight', async ({ page }) => {
  await installAppHarness(page, { updateDelay: 200 });
  await openCatalog(page);
  const checkButton = page.getByRole('button', { name: 'Check for playlist updates' });

  await checkButton.click();
  await expect(page.getByRole('button', { name: 'Check for playlist updates' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Check for playlist updates' })).toBeEnabled();
});
