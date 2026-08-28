import { expect, test, type Page } from '@playwright/test';
import type { Playlist } from '../../shared/types';
import { playlistPath } from '../../src/navigation';
import { browserCatalog, collectionPlaylist, summerPlaylist } from './catalog-fixture';
import { installAppHarness } from './harness';
import { sdkSnapshot, type MockProvider } from './mock-sdks';
import {
  clearSdkCalls,
  expectCurrentTrack,
  latestInstance,
  openCatalog,
  providerCalls,
  selectPlaylist,
  setProviderProgress,
  waitForProviderPlaying,
} from './test-helpers';

async function expectPlaylist(page: Page, playlist: Playlist): Promise<void> {
  await expect(page).toHaveURL(new URL(playlistPath(playlist.id), page.url()).href);
  await expect(page.getByRole('heading', { name: playlist.title, exact: true })).toBeVisible();
  await expect(page).toHaveTitle(`${playlist.title} — pilldiff`);
  await expect(page.locator('.archive-playlist-link[aria-current="page"]'))
    .toHaveAttribute('href', playlistPath(playlist.id));
}

async function expectPausedCue(page: Page, title: string, provider: MockProvider): Promise<void> {
  await expectCurrentTrack(page, title);
  await expect(page.getByLabel('Now playing source').getByText('paused', { exact: true })).toBeVisible();
  await expect.poll(async () => (await latestInstance(page, provider))?.playing).toBe(false);
  expect(await providerCalls(page, 'youtube', ['loadVideoById', 'loadPlaylist', 'playVideo'])).toHaveLength(0);
  expect(await providerCalls(page, 'soundcloud', ['play'])).toHaveLength(0);
}

test('replaces the root URL and avoids duplicate history for the selected playlist', async ({ page }) => {
  await installAppHarness(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('navigation.initialHistoryLength', String(history.length));
  });
  await openCatalog(page);
  await expectPlaylist(page, summerPlaylist);
  const initialHistoryLength = await page.evaluate(() => (
    Number(sessionStorage.getItem('navigation.initialHistoryLength'))
  ));
  expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength);

  await selectPlaylist(page, summerPlaylist.shortTitle);
  expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength);
  await selectPlaylist(page, collectionPlaylist.shortTitle);
  await expectPlaylist(page, collectionPlaylist);
  expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength + 1);
  await page.goBack();
  await expectPlaylist(page, summerPlaylist);
});

test('cues a fresh nonfirst deep link paused instead of the newest playlist', async ({ page }) => {
  await installAppHarness(page);
  await page.goto(playlistPath(collectionPlaylist.id));
  await expectPlaylist(page, collectionPlaylist);
  await expectPausedCue(page, 'Video Constellation', 'youtube');
  await expect.poll(async () => (await providerCalls(page, 'youtube', ['cuePlaylist'])).length).toBe(1);
  expect(await providerCalls(page, 'youtube', ['cueVideoById'])).toHaveLength(0);
  await expect(page.getByLabel('Playback controls').getByText('1 of 2 · blog order')).toBeVisible();
});

test('uses real archive hrefs and preserves the browsed playlist on reload', async ({ page }) => {
  await installAppHarness(page);
  await openCatalog(page);
  const archive = page.getByRole('complementary', { name: 'Playlist archive' });
  await expect(archive.getByRole('link', { name: /^Collections 2025/ }))
    .toHaveAttribute('href', playlistPath(collectionPlaylist.id));
  await expect(archive.getByRole('link', { name: `Open ${collectionPlaylist.title} on billdifferen` }))
    .toHaveAttribute('href', collectionPlaylist.sourceUrl);

  await selectPlaylist(page, collectionPlaylist.shortTitle);
  await expectPlaylist(page, collectionPlaylist);
  await expectCurrentTrack(page, 'Sunrise Relay');
  await page.reload();
  await expectPlaylist(page, collectionPlaylist);
  await expectPausedCue(page, 'Sunrise Relay', 'youtube');
});

test('opens a copied playlist URL in a fresh isolated context', async ({ page, browser }) => {
  await installAppHarness(page);
  await openCatalog(page);
  await selectPlaylist(page, collectionPlaylist.shortTitle);
  await expectPlaylist(page, collectionPlaylist);
  const copiedUrl = page.url();
  const freshContext = await browser.newContext();
  try {
    const freshPage = await freshContext.newPage();
    await installAppHarness(freshPage);
    await freshPage.goto(copiedUrl);
    await expectPlaylist(freshPage, collectionPlaylist);
    await expectPausedCue(freshPage, 'Video Constellation', 'youtube');
  } finally {
    await freshContext.close();
  }
});

test('preserves Blogger IDs larger than safe integers in direct playlist URLs', async ({ page }) => {
  const linkedPlaylist = { ...collectionPlaylist, id: '4187003885016673397' };
  await installAppHarness(page, {
    catalog: { ...browserCatalog, playlists: [summerPlaylist, linkedPlaylist] },
  });
  await page.goto('/playlists/4187003885016673397');
  await expectPlaylist(page, linkedPlaylist);
  await expectPausedCue(page, 'Video Constellation', 'youtube');
});

for (const track of summerPlaylist.tracks.slice(0, 2)) {
  test(`keeps ${track.provider} playback, queue, and progress intact through Back and Forward`, async ({ page }) => {
    let catalogRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/catalog.json') {
        catalogRequests += 1;
      }
    });
    await installAppHarness(page);
    await openCatalog(page);
    await page.getByRole('button', { name: `Play ${track.title}`, exact: true }).click();
    await waitForProviderPlaying(page, track.provider);
    await page.getByRole('button', { name: 'Reverse', exact: true }).click();
    await setProviderProgress(page, track.provider, 37, 240);
    const transport = page.getByLabel('Playback controls');
    await expect(transport.getByText('0:37', { exact: true })).toBeVisible();
    const originalInstances = (await sdkSnapshot(page)).instances;
    const originalRequestCount = catalogRequests;
    await clearSdkCalls(page);

    await selectPlaylist(page, collectionPlaylist.shortTitle);
    await expectPlaylist(page, collectionPlaylist);
    await expect(page.getByRole('button', { name: 'Blog order', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Reverse', exact: true }).click();
    await page.goBack();
    await expectPlaylist(page, summerPlaylist);
    await expect(page.getByRole('button', { name: 'Reverse', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goForward();
    await expectPlaylist(page, collectionPlaylist);
    await expect(page.getByRole('button', { name: 'Reverse', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await expectCurrentTrack(page, track.title);
    await waitForProviderPlaying(page, track.provider);
    await expect(transport.getByText('0:37', { exact: true })).toBeVisible();
    await expect(transport.getByText(`${summerPlaylist.tracks.length - track.position} of 4 · reverse`)).toBeVisible();
    await expect(transport.getByText(summerPlaylist.shortTitle, { exact: true })).toBeVisible();
    expect((await sdkSnapshot(page)).instances).toEqual(originalInstances);
    expect((await sdkSnapshot(page)).calls).toHaveLength(0);
    expect(catalogRequests).toBe(originalRequestCount);

    const previousTrack = summerPlaylist.tracks[track.position + 1];
    await transport.getByRole('button', { name: 'Previous track', exact: true }).click();
    await expectCurrentTrack(page, previousTrack.title);
    await waitForProviderPlaying(page, previousTrack.provider);
    await expectPlaylist(page, collectionPlaylist);
  });
}

for (const action of ['modifier click', 'middle click']) {
  test(`keeps the current tab and mobile drawer unchanged on a native ${action}`, async ({ page, context }) => {
    await installAppHarness(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openCatalog(page);
    await page.getByRole('button', { name: 'Open playlist archive' }).click();
    const originalUrl = page.url();
    const originalInstances = (await sdkSnapshot(page)).instances;
    await clearSdkCalls(page);
    await context.route(`**${playlistPath(collectionPlaylist.id)}`, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native playlist link destination</title>',
    }));
    const tabPromise = context.waitForEvent('page');
    const playlistLink = page.getByRole('complementary', { name: 'Playlist archive' })
      .getByRole('link', { name: /^Collections 2025/ });
    if (action === 'modifier click') {
      await playlistLink.click({ modifiers: ['ControlOrMeta'] });
    } else {
      await playlistLink.click({ button: 'middle' });
    }
    const newTab = await tabPromise;
    try {
      await expect(newTab).toHaveURL(new URL(playlistPath(collectionPlaylist.id), originalUrl).href);
      await expect(page).toHaveURL(originalUrl);
      await expect(page.getByRole('button', { name: 'Open playlist archive' }))
        .toHaveAttribute('aria-expanded', 'true');
      await expectPlaylist(page, summerPlaylist);
      expect((await sdkSnapshot(page)).instances).toEqual(originalInstances);
      expect((await sdkSnapshot(page)).calls).toHaveLength(0);
    } finally {
      await newTab.close();
    }
  });
}

for (const path of ['/playlists/unknown-id', '/playlists/', '/playlists', '/not-a-playlist']) {
  test(`shows a recoverable not-found view without changing ${path}`, async ({ page }) => {
    await installAppHarness(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Playlist not found.', exact: true })).toBeVisible();
    await expect(page).toHaveTitle('Playlist not found — pilldiff');
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.locator('.archive-playlist-link[aria-current]')).toHaveCount(0);
    const recovery = page.getByRole('link', { name: 'Browse latest playlist' });
    await expect(recovery).toHaveAttribute('href', playlistPath(summerPlaylist.id));
    await recovery.click();
    await expectPlaylist(page, summerPlaylist);
  });
}

test('handles malformed path encoding without crashing or selecting the wrong playlist', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAppHarness(page);
  await openCatalog(page);
  await page.evaluate(() => history.pushState(null, '', '/playlists/%E0%A4%A'));
  await expect(page.getByRole('heading', { name: 'Playlist not found.', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Playlist not found — pilldiff');
  expect(new URL(page.url()).pathname).toBe('/playlists/%E0%A4%A');
  await expectCurrentTrack(page, 'Sunrise Relay');
  expect(errors).toEqual([]);
  await page.getByRole('link', { name: 'Browse latest playlist' }).click();
  await expectPlaylist(page, summerPlaylist);
});

test('keeps an empty root quiet without redirecting and recovers missing links to it', async ({ page }) => {
  await installAppHarness(page, { catalog: { ...browserCatalog, playlists: [] } });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The archive is quiet.', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page).toHaveTitle('pilldiff — the billdifferen playlist player');
  await page.goto('/playlists/missing');
  await expect(page.getByRole('heading', { name: 'Playlist not found.', exact: true })).toBeVisible();
  const recovery = page.getByRole('link', { name: 'Back to archive' });
  await expect(recovery).toHaveAttribute('href', '/');
  await recovery.click();
  await expect(page.getByRole('heading', { name: 'The archive is quiet.', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  expect((await sdkSnapshot(page)).instances).toHaveLength(0);
});

test('keeps the URL and player when an update removes the browsed playlist', async ({ page }) => {
  await installAppHarness(page, {
    updatedCatalog: { ...browserCatalog, playlists: [summerPlaylist] },
  });
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play playback', exact: true }).click();
  await waitForProviderPlaying(page, 'youtube');
  await setProviderProgress(page, 'youtube', 41, 240);
  await expect(page.getByLabel('Playback controls').getByText('0:41', { exact: true })).toBeVisible();
  await selectPlaylist(page, collectionPlaylist.shortTitle);
  await expectPlaylist(page, collectionPlaylist);
  const originalInstances = (await sdkSnapshot(page)).instances;
  await clearSdkCalls(page);

  await page.getByRole('button', { name: 'Check for playlist updates' }).click();
  await expect(page.getByRole('heading', { name: 'Playlist not found.', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Playlist not found — pilldiff');
  expect(new URL(page.url()).pathname).toBe(playlistPath(collectionPlaylist.id));
  await expect(page.getByRole('heading', { name: summerPlaylist.title, exact: true })).toHaveCount(0);
  await expect(page.locator('.archive-playlist-link[aria-current]')).toHaveCount(0);
  await expectCurrentTrack(page, 'Sunrise Relay');
  await waitForProviderPlaying(page, 'youtube');
  await expect(page.getByLabel('Playback controls').getByText('0:41', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Playback controls').getByText('1 of 4 · blog order')).toBeVisible();
  await page.getByRole('link', { name: 'Browse latest playlist' }).click();
  await expectPlaylist(page, summerPlaylist);
  expect((await sdkSnapshot(page)).instances).toEqual(originalInstances);
  expect((await sdkSnapshot(page)).calls).toHaveLength(0);
});

test('restores a different saved player paused while the URL controls the browsed playlist', async ({ page }) => {
  await installAppHarness(page, {
    localStorage: {
      'pilldiff.playback.v1': JSON.stringify({
        version: 1,
        playlistId: summerPlaylist.id,
        trackId: 'soundcloud-river',
        order: 'reverse',
        volume: 0.42,
        progress: 18,
        hasStarted: true,
      }),
    },
  });
  await page.goto(playlistPath(collectionPlaylist.id));
  await expectPlaylist(page, collectionPlaylist);
  await expectPausedCue(page, 'River Signal', 'soundcloud');
  await expect(page.getByRole('button', { name: 'Blog order', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const transport = page.getByLabel('Playback controls');
  await expect(transport.getByText('0:18', { exact: true })).toBeVisible();
  await expect(transport.getByText('3 of 4 · reverse', { exact: true })).toBeVisible();
  await expect(transport.getByText(summerPlaylist.shortTitle, { exact: true })).toBeVisible();
  await expect.poll(async () => (await latestInstance(page, 'soundcloud'))?.position).toBe(18);
});
