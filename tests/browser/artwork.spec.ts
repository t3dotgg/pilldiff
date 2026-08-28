import { expect, test, type Page } from '@playwright/test';
import type { CatalogResponse } from '../../shared/types';
import { catalogResponse } from './catalog-fixture';
import { installAppHarness } from './harness';
import { clearSdkCalls, latestInstance, openCatalog, providerCalls, selectPlaylist, waitForProviderPlaying } from './test-helpers';

const artworkBody = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#a3332d"/></svg>';
const secondArtwork = 'https://example.test/art/collections.jpg';

function responseWithArtwork(): CatalogResponse {
  const response = structuredClone(catalogResponse());
  response.catalog.playlists[1].artworkUrl = secondArtwork;
  return response;
}

async function deferArtwork(page: Page, deferredUrl: string, fail = false) {
  let release!: () => void;
  let finished!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const settled = new Promise<void>((resolve) => { finished = resolve; });
  await page.route('https://example.test/art/**', async (route) => {
    const deferred = route.request().url() === deferredUrl;
    if (deferred) await gate;
    try {
      if (deferred && fail) await route.abort();
      else await route.fulfill({ contentType: 'image/svg+xml', body: artworkBody });
    } finally {
      if (deferred) finished();
    }
  });
  return { release, settled };
}

test('replaces the old artwork immediately while the selected image loads', async ({ page }) => {
  await installAppHarness(page, { response: responseWithArtwork() });
  const pending = await deferArtwork(page, secondArtwork);
  await openCatalog(page);
  await expect(page.locator('.artwork')).toHaveAttribute('data-state', 'ready');
  const oldImage = await page.locator('.artwork img').elementHandle();
  await page.getByRole('button', { name: 'Play playback', exact: true }).click();
  await waitForProviderPlaying(page, 'youtube');
  const active = await latestInstance(page, 'youtube');
  await clearSdkCalls(page);

  await selectPlaylist(page, 'Collections 2025');
  await expect(page.locator('.artwork')).toHaveAttribute('data-state', 'loading');
  await expect(page.locator('.artwork img')).toHaveAttribute('src', secondArtwork);
  await expect(page.locator('.artwork img')).toBeHidden();
  await expect(page.getByRole('img', { name: 'Loading artwork for Collections 2025', exact: true })).toBeVisible();
  expect(await oldImage?.evaluate((image) => image.isConnected)).toBe(false);

  pending.release();
  await expect(page.getByRole('img', { name: 'Artwork from Collections 2025', exact: true })).toBeVisible();
  expect((await latestInstance(page, 'youtube'))?.instanceId).toBe(active?.instanceId);
  expect((await latestInstance(page, 'youtube'))?.playing).toBe(true);
  expect(await providerCalls(page, 'youtube', ['pauseVideo', 'destroy'])).toHaveLength(0);
});

test('ignores a late failure from a previously selected image', async ({ page }) => {
  await installAppHarness(page, { response: responseWithArtwork() });
  const pending = await deferArtwork(page, secondArtwork, true);
  await openCatalog(page);
  await expect(page.locator('.artwork')).toHaveAttribute('data-state', 'ready');
  await selectPlaylist(page, 'Collections 2025');
  await expect(page.locator('.artwork')).toHaveAttribute('data-state', 'loading');
  await selectPlaylist(page, 'July 2026');
  await expect(page.locator('.artwork')).toHaveAttribute('data-state', 'ready');
  pending.release();
  await pending.settled;
  await expect(page.getByRole('img', { name: 'Artwork from July 2026', exact: true })).toBeVisible();
  await expect(page.locator('.artwork-placeholder')).toHaveCount(0);
});

test('shows the newly selected identity when artwork is missing or broken', async ({ page }) => {
  const response = responseWithArtwork();
  const missingPlaylist = { ...response.catalog.playlists[1], id: 'missing-art', title: 'Missing art', shortTitle: 'Missing art', artworkUrl: undefined };
  response.catalog.playlists.push(missingPlaylist);
  await installAppHarness(page, { response });
  const pending = await deferArtwork(page, secondArtwork, true);
  await openCatalog(page);
  await expect(page.locator('.artwork')).toHaveAttribute('data-state', 'ready');

  await selectPlaylist(page, 'Missing art');
  await expect(page.locator('.artwork img')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Artwork unavailable for Missing art' })).toBeVisible();
  await selectPlaylist(page, 'Collections 2025');
  pending.release();
  await expect(page.getByRole('img', { name: 'Artwork unavailable for Collections 2025' })).toBeVisible();
  await expect(page.locator('.artwork img')).toHaveCount(0);
  await selectPlaylist(page, 'July 2026');
  await expect(page.getByRole('img', { name: 'Artwork from July 2026', exact: true })).toBeVisible();
});

test('resets artwork on catalog refresh even when the playlist ID stays the same', async ({ page }) => {
  const response = responseWithArtwork();
  const refreshResponse = structuredClone(response);
  const refreshedUrl = 'https://example.test/art/revised.jpg';
  refreshResponse.catalog.playlists[0].artworkUrl = refreshedUrl;
  await installAppHarness(page, { response, refreshResponse });
  const pending = await deferArtwork(page, refreshedUrl);
  await openCatalog(page);
  await expect(page.locator('.artwork')).toHaveAttribute('data-state', 'ready');
  const oldImage = await page.locator('.artwork img').elementHandle();

  await page.getByRole('button', { name: 'Refresh playlist archive' }).click();
  await expect(page.locator('.artwork')).toHaveAttribute('data-state', 'loading');
  await expect(page.locator('.artwork img')).toHaveAttribute('src', refreshedUrl);
  await expect(page.locator('.artwork img')).toBeHidden();
  expect(await oldImage?.evaluate((image) => image.isConnected)).toBe(false);
  pending.release();
  await expect(page.getByRole('img', { name: 'Artwork from July 2026', exact: true })).toBeVisible();
});
