import { expect, test } from '@playwright/test';
import { catalogResponse } from './catalog-fixture';
import { installAppHarness } from './harness';
import { clearSdkCalls, finishProvider, openCatalog, providerCalls, selectPlaylist, waitForProviderPlaying } from './test-helpers';

function responseWithNotes() {
  const response = structuredClone(catalogResponse());
  response.catalog.playlists[0].tracks[0].description = 'An opening note with a little room to breathe.\n\nA second paragraph with <img src=x onerror=alert(1)> as plain text.';
  response.catalog.playlists[0].tracks[1].description = 'A different note for the SoundCloud song.';
  response.catalog.playlists[1].tracks[0].description = 'An album note from the other playlist.';
  return response;
}

test('renders expandable plain-text notes without starting playback', async ({ page }) => {
  await installAppHarness(page, { response: responseWithNotes() });
  await openCatalog(page);
  await clearSdkCalls(page);
  const row = page.locator('.track-list > li').filter({ has: page.getByRole('button', { name: 'Play Sunrise Relay', exact: true }) });
  const details = row.locator('details');
  const summary = row.locator('summary');
  await expect(details).not.toHaveAttribute('open', '');
  await summary.click();
  await expect(details).toHaveAttribute('open', '');
  await expect(row.locator('.notes-prose p')).toHaveCount(2);
  await expect(row.getByText(/<img src=x onerror=alert\(1\)>/)).toBeVisible();
  await expect(row.locator('.notes-prose img, .notes-prose script')).toHaveCount(0);
  await expect(row.getByRole('link', { name: 'Read on the blog' })).toHaveAttribute('href', responseWithNotes().catalog.playlists[0].sourceUrl);

  await summary.focus();
  await page.keyboard.press('Space');
  await expect(details).not.toHaveAttribute('open', '');
  expect(await providerCalls(page, 'youtube', ['playVideo'])).toHaveLength(0);
  const withoutNotes = page.locator('.track-list > li').filter({ has: page.getByRole('button', { name: 'Play Night Geometry', exact: true }) });
  await expect(withoutNotes.locator('details')).toHaveCount(0);
});

test('keeps notes with their song across reversing, browsing, and provider handoff', async ({ page }) => {
  await installAppHarness(page, { response: responseWithNotes() });
  await openCatalog(page);
  await page.getByRole('button', { name: 'Reverse', exact: true }).click();
  const firstRow = page.locator('.track-list > li').first();
  await expect(firstRow.getByRole('button', { name: 'Play Static Orchard' })).toBeVisible();
  await expect(firstRow.locator('details')).toHaveCount(0);
  await page.getByRole('button', { name: 'Blog order', exact: true }).click();
  await page.getByRole('button', { name: 'Play selected playlist' }).click();
  await waitForProviderPlaying(page, 'youtube');
  const currentNotes = page.locator('.now-playing-notes');
  await expect(currentNotes.getByText('An opening note with a little room to breathe.')).toBeVisible();

  await selectPlaylist(page, 'Collections 2025');
  await expect(currentNotes.getByText('An opening note with a little room to breathe.')).toBeVisible();
  const otherNotes = page.locator('.track-list summary');
  await otherNotes.click();
  await expect(page.locator('.track-list').getByText('An album note from the other playlist.')).toBeVisible();
  await expect(currentNotes.getByText('An album note from the other playlist.')).toHaveCount(0);

  await finishProvider(page, 'youtube');
  await waitForProviderPlaying(page, 'soundcloud');
  await expect(currentNotes.getByText('A different note for the SoundCloud song.')).toBeVisible();
  await expect(currentNotes.getByText('An opening note with a little room to breathe.')).toHaveCount(0);
});

test('keeps active editorial notes unchanged when the browsing catalog refreshes', async ({ page }) => {
  const response = responseWithNotes();
  const refreshResponse = structuredClone(response);
  refreshResponse.catalog.playlists[0].tracks[0].description = 'An edited note in the refreshed catalog.';
  await installAppHarness(page, { response, refreshResponse });
  await openCatalog(page);
  await page.getByRole('button', { name: 'Play selected playlist' }).click();
  await waitForProviderPlaying(page, 'youtube');
  await page.getByRole('button', { name: 'Refresh playlist archive' }).click();
  await page.locator('.track-list summary').first().click();
  await expect(page.locator('.track-list').getByText('An edited note in the refreshed catalog.')).toBeVisible();
  await expect(page.locator('.now-playing-notes').getByText('An opening note with a little room to breathe.')).toBeVisible();
  await waitForProviderPlaying(page, 'youtube');
});
