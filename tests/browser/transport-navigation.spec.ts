import { expect, test, type Page } from '@playwright/test';
import type { Playlist, Track } from '../../shared/types';
import { playlistPath } from '../../src/navigation';
import { browserCatalog, collectionPlaylist, summerPlaylist } from './catalog-fixture';
import { installAppHarness } from './harness';
import { sdkSnapshot } from './mock-sdks';
import {
  clearSdkCalls,
  expectCurrentTrack,
  finishProvider,
  latestInstance,
  openCatalog,
  selectPlaylist,
  setProviderProgress,
  waitForProviderPlaying,
} from './test-helpers';

const longPlaylist: Playlist = {
  ...summerPlaylist,
  artworkUrl: undefined,
  tracks: Array.from({ length: 60 }, (unusedValue, index) => {
    const template = summerPlaylist.tracks[index % summerPlaylist.tracks.length];
    return {
      ...template,
      id: `${template.id}-${index}`,
      title: `Listening entry ${index + 1}`,
      label: `Listening entry ${index + 1}`,
      position: index,
      rank: 60 - index,
    };
  }),
};
const catalog = { ...browserCatalog, playlists: [longPlaylist, collectionPlaylist] };

async function playTrack(page: Page, track: Track): Promise<void> {
  await page.getByRole('button', { name: `Play ${track.label}`, exact: true }).click();
  await waitForProviderPlaying(page, track.provider);
  await setProviderProgress(page, track.provider, 37, 240);
  await expect(page.getByLabel('Playback controls').getByRole('slider', { name: 'Seek' })).toHaveValue('37');
}

async function expectRevealedTrack(page: Page, track: Track): Promise<void> {
  const row = page.locator('.track-list > li.is-current');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(row.locator('.track-copy strong')).toHaveText(track.title);
  await expect(row).toBeFocused();
  await expect.poll(async () => {
    const trackBounds = await row.locator('.track-main').boundingBox();
    const headerBounds = await page.getByRole('banner').boundingBox();
    const transportBounds = await page.getByLabel('Playback controls').boundingBox();
    return Boolean(trackBounds && headerBounds && transportBounds
      && trackBounds.y >= headerBounds.y + headerBounds.height
      && trackBounds.y + trackBounds.height <= transportBounds.y);
  }).toBe(true);
}

for (const scenario of [
  { provider: 'youtube', label: 'track', order: 'original', position: 28 },
  { provider: 'soundcloud', label: 'playlist', order: 'original', position: 29 },
  { provider: 'youtube', label: 'playlist', order: 'reverse', position: 28 },
  { provider: 'soundcloud', label: 'track', order: 'reverse', position: 29 },
] as const) {
  test(`returns from the ${scenario.label} label to ${scenario.provider} in ${scenario.order} order`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installAppHarness(page, { catalog });
    await openCatalog(page);
    const track = longPlaylist.tracks[scenario.position];
    await playTrack(page, track);
    if (scenario.order === 'reverse') {
      await page.getByRole('button', { name: 'Reverse', exact: true }).click();
    }
    const originalInstances = (await sdkSnapshot(page)).instances;
    await clearSdkCalls(page);
    await selectPlaylist(page, collectionPlaylist.shortTitle);
    const transport = page.getByLabel('Playback controls');
    const link = transport.getByRole('link', {
      name: scenario.label === 'track'
        ? `Show current track: ${track.title}`
        : `Show playing playlist: ${longPlaylist.shortTitle}`,
      exact: true,
    });
    await expect(link).toHaveAttribute('href', playlistPath(longPlaylist.id));
    await link.click();

    await expect(page).toHaveURL(new RegExp(`${playlistPath(longPlaylist.id)}$`));
    await expectRevealedTrack(page, track);
    await expect(page.getByRole('button', { name: scenario.order === 'reverse' ? 'Reverse' : 'Blog order', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    const queuePosition = scenario.order === 'reverse' ? 60 - track.position : track.position + 1;
    await expect(transport.getByText(`${queuePosition} of 60 · ${scenario.order === 'reverse' ? 'reverse' : 'blog order'}`, { exact: true }))
      .toBeVisible();

    const historyLength = await page.evaluate(() => history.length);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await link.focus();
    await link.press('Enter');
    await expectRevealedTrack(page, track);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    await expect(transport.getByRole('slider', { name: 'Seek' })).toHaveValue('37');
    await waitForProviderPlaying(page, track.provider);
    expect((await sdkSnapshot(page)).instances).toEqual(originalInstances);
    expect((await sdkSnapshot(page)).calls).toHaveLength(0);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await finishProvider(page, track.provider);
    const nextTrack = longPlaylist.tracks[track.position + (scenario.order === 'reverse' ? -1 : 1)];
    await expectCurrentTrack(page, nextTrack.title);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${playlistPath(collectionPlaylist.id)}$`));
    await waitForProviderPlaying(page, nextTrack.provider);
  });
}

for (const width of [390, 320]) {
  test(`returns to the playing track above the player at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installAppHarness(page, { catalog });
    await openCatalog(page);
    const track = longPlaylist.tracks[29];
    await playTrack(page, track);
    await selectPlaylist(page, collectionPlaylist.shortTitle);
    await clearSdkCalls(page);
    await page.getByRole('link', { name: `Show current track: ${track.title}`, exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Playlist archive' })).toBeHidden();
    await expectRevealedTrack(page, track);
    await waitForProviderPlaying(page, track.provider);
    await expect(page.getByLabel('Playback controls').getByRole('slider', { name: 'Seek' })).toHaveValue('37');
    expect((await sdkSnapshot(page)).calls).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('reveals unstarted and paused tracks without starting or seeking playback', async ({ page }) => {
  await installAppHarness(page, { catalog });
  await openCatalog(page);
  await clearSdkCalls(page);
  await page.getByRole('link', { name: `Show current track: ${longPlaylist.tracks[0].title}`, exact: true }).click();
  await expectRevealedTrack(page, longPlaylist.tracks[0]);
  await expect(page.getByLabel('Playback controls').getByRole('button', { name: 'Play playback', exact: true })).toBeVisible();
  expect((await sdkSnapshot(page)).calls).toHaveLength(0);

  const track = longPlaylist.tracks[28];
  await playTrack(page, track);
  await page.getByLabel('Playback controls').getByRole('button', { name: 'Pause playback', exact: true }).click();
  await expect.poll(async () => (await latestInstance(page, track.provider))?.playing).toBe(false);
  await selectPlaylist(page, collectionPlaylist.shortTitle);
  await clearSdkCalls(page);
  const link = page.getByRole('link', { name: `Show current track: ${track.title}`, exact: true });
  await link.focus();
  await link.press('Enter');
  await expectRevealedTrack(page, track);
  await expect(page.getByLabel('Playback controls').getByRole('button', { name: 'Play playback', exact: true })).toBeVisible();
  await expect(page.getByLabel('Playback controls').getByRole('slider', { name: 'Seek' })).toHaveValue('37');
  expect((await sdkSnapshot(page)).calls).toHaveLength(0);
});

for (const removed of ['track', 'playlist']) {
  test(`falls back safely when an update removed the playing ${removed}`, async ({ page }) => {
    const track = longPlaylist.tracks[28];
    const updatedPlaylist = {
      ...longPlaylist,
      title: 'Updated July 2026',
      shortTitle: 'Updated July 2026',
      tracks: longPlaylist.tracks.filter((entry) => entry.id !== track.id),
    };
    await installAppHarness(page, {
      catalog,
      updatedCatalog: {
        ...catalog,
        playlists: removed === 'track' ? [updatedPlaylist, collectionPlaylist] : [collectionPlaylist],
      },
    });
    await openCatalog(page);
    await playTrack(page, track);
    const originalInstances = (await sdkSnapshot(page)).instances;
    await selectPlaylist(page, collectionPlaylist.shortTitle);
    await clearSdkCalls(page);
    await page.getByRole('button', { name: 'Check for playlist updates' }).click();
    if (removed === 'track') {
      await expect(page.locator('.archive-playlist-link').filter({ hasText: updatedPlaylist.title })).toHaveCount(1);
    } else {
      await expect(page.locator('.archive-playlist-link')).toHaveCount(1);
    }
    await page.getByRole('link', { name: `Show current track: ${track.title}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${playlistPath(longPlaylist.id)}$`));
    await expect(page.getByRole('heading', { name: removed === 'track' ? updatedPlaylist.title : 'Playlist not found.', exact: true }))
      .toBeFocused();
    await expect(page.locator('.track-list > li.is-current')).toHaveCount(0);
    await expectCurrentTrack(page, track.title);
    await waitForProviderPlaying(page, track.provider);
    await expect(page.getByLabel('Playback controls').getByRole('slider', { name: 'Seek' })).toHaveValue('37');
    expect((await sdkSnapshot(page)).instances).toEqual(originalInstances);
    expect((await sdkSnapshot(page)).calls).toHaveLength(0);
  });
}

for (const action of ['modifier click', 'middle click']) {
  test(`preserves native ${action} behavior on the playing track link`, async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installAppHarness(page, { catalog });
    await openCatalog(page);
    const track = longPlaylist.tracks[28];
    await playTrack(page, track);
    await selectPlaylist(page, collectionPlaylist.shortTitle);
    const originalUrl = page.url();
    await clearSdkCalls(page);
    await context.route(`**${playlistPath(longPlaylist.id)}`, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Playing playlist destination</title>',
    }));
    const tabPromise = context.waitForEvent('page');
    const link = page.getByRole('link', { name: `Show current track: ${track.title}`, exact: true });
    if (action === 'modifier click') {
      await link.click({ modifiers: ['ControlOrMeta'] });
    } else {
      await link.click({ button: 'middle' });
    }
    const newTab = await tabPromise;
    try {
      await expect(newTab).toHaveURL(new URL(playlistPath(longPlaylist.id), originalUrl).href);
      await expect(page).toHaveURL(originalUrl);
      await expect(page.getByRole('button', { name: 'Open playlist archive' })).toHaveAttribute('aria-expanded', 'false');
      await waitForProviderPlaying(page, track.provider);
      expect((await sdkSnapshot(page)).calls).toHaveLength(0);
    } finally {
      await newTab.close();
    }
  });
}

test('keeps idle playback labels noninteractive when no playlist is available', async ({ page }) => {
  await installAppHarness(page, { catalog: { ...browserCatalog, totalPosts: 0, playlists: [] } });
  await page.goto('/');
  const transport = page.getByLabel('Playback controls');
  await expect(transport.getByText('Nothing cued', { exact: true })).toBeVisible();
  await expect(transport.getByRole('link')).toHaveCount(0);
});
