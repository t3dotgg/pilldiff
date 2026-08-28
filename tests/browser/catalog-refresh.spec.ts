import { expect, test } from '@playwright/test';
import type { Playlist } from '../../shared/types';
import {
  browserCatalog,
  catalogResponse,
  collectionPlaylist,
  summerPlaylist,
} from './catalog-fixture';
import { installAppHarness } from './harness';
import {
  clearSdkCalls,
  expectCurrentTrack,
  latestInstance,
  openCatalog,
  providerCalls,
  setProviderProgress,
  waitForProviderPlaying,
} from './test-helpers';

const replacementPlaylist: Playlist = {
  ...summerPlaylist,
  title: 'July 2026 — Updated Catalog',
  shortTitle: 'July 2026 updated',
  tracks: [
    {
      ...summerPlaylist.tracks[0],
      id: 'youtube-refreshed',
      title: 'Refreshed Opening',
      label: 'Refreshed Opening',
      videoId: 'yt-refreshed',
      sourceUrl: 'https://www.youtube.com/watch?v=yt-refreshed',
      playbackUrl: 'https://www.youtube.com/watch?v=yt-refreshed',
    },
    ...summerPlaylist.tracks.slice(2),
  ],
};

const refreshScenarios = [
  {
    name: 'replaces its current track',
    playlists: [replacementPlaylist, collectionPlaylist],
    browseTitle: replacementPlaylist.title,
  },
  {
    name: 'removes its playlist',
    playlists: [collectionPlaylist],
    browseTitle: collectionPlaylist.title,
  },
];

for (const scenario of refreshScenarios) {
  test(`keeps the captured active queue when refresh ${scenario.name}`, async ({ page }) => {
    await installAppHarness(page, {
      refreshResponse: catalogResponse({
        catalog: {
          ...browserCatalog,
          fetchedAt: '2026-08-28T08:00:00.000Z',
          playlists: scenario.playlists,
        },
      }),
    });
    await openCatalog(page);
    await page.getByRole('button', { name: 'Play playback', exact: true }).click();
    await waitForProviderPlaying(page, 'youtube');
    await setProviderProgress(page, 'youtube', 41, 240);
    const transport = page.getByRole('contentinfo', { name: 'Playback controls' });
    await expect(transport.getByText('0:41', { exact: true })).toBeVisible();
    const originalInstance = await latestInstance(page, 'youtube');
    await clearSdkCalls(page);

    const refreshResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST' && response.url().endsWith('/api/catalog/refresh')
    ));
    await page.getByRole('button', { name: 'Refresh playlist archive' }).click();
    await refreshResponse;
    await expect(page.getByRole('heading', { name: scenario.browseTitle, exact: true })).toBeVisible();

    await expectCurrentTrack(page, 'Sunrise Relay');
    await waitForProviderPlaying(page, 'youtube');
    await expect(page.locator('.youtube-frame iframe')).toBeVisible();
    await expect(transport.getByText(summerPlaylist.shortTitle, { exact: true })).toBeVisible();
    await expect(transport.getByText('1 of 4 · blog order', { exact: true })).toBeVisible();
    await expect(transport.getByText('0:41', { exact: true })).toBeVisible();
    expect((await latestInstance(page, 'youtube'))?.instanceId).toBe(originalInstance?.instanceId);
    expect(await providerCalls(page, 'youtube', ['pauseVideo', 'destroy', 'cueVideoById', 'loadVideoById']))
      .toHaveLength(0);

    await transport.getByRole('button', { name: 'Pause playback', exact: true }).click();
    await expect(transport.getByRole('button', { name: 'Play playback', exact: true })).toBeVisible();
    await expect.poll(async () => (await latestInstance(page, 'youtube'))?.playing).toBe(false);
    await transport.getByRole('slider', { name: 'Seek', exact: true }).fill('72.5');
    await expect.poll(async () => (await latestInstance(page, 'youtube'))?.position).toBe(72.5);
    expect((await providerCalls(page, 'youtube', ['seekTo'])).at(-1)?.arguments).toEqual([72.5, true]);

    await transport.getByRole('button', { name: 'Play playback', exact: true }).click();
    await waitForProviderPlaying(page, 'youtube');
    await expect(transport.getByRole('slider', { name: 'Seek', exact: true })).toHaveValue('72.5');
    expect((await latestInstance(page, 'youtube'))?.instanceId).toBe(originalInstance?.instanceId);
    expect(await providerCalls(page, 'youtube', ['destroy', 'cueVideoById', 'loadVideoById']))
      .toHaveLength(0);

    await transport.getByRole('button', { name: 'Next track', exact: true }).click();
    await expectCurrentTrack(page, 'River Signal');
    await waitForProviderPlaying(page, 'soundcloud');
    await expect.poll(async () => (await latestInstance(page, 'youtube'))?.playing).toBe(false);
    await expect(page.locator('.youtube-frame')).toBeHidden();
    await expect(page.locator('.soundcloud-frame iframe')).toBeVisible();
    expect((await latestInstance(page, 'soundcloud'))?.mediaId).toBe(summerPlaylist.tracks[1].playbackUrl);
    await expect(transport.getByText(summerPlaylist.shortTitle, { exact: true })).toBeVisible();
    await expect(transport.getByText('2 of 4 · blog order', { exact: true })).toBeVisible();
  });
}
