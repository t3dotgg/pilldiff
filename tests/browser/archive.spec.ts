import { expect, test, type Page } from '@playwright/test';
import type { Playlist } from '../../shared/types';
import { playlistPath } from '../../src/navigation';
import { browserCatalog, collectionPlaylist, summerPlaylist } from './catalog-fixture';
import { installAppHarness } from './harness';

const longTitle = 'Favorite songs of the year, part one: late-night discoveries, long summer afternoons, and everything worth coming back to';
const readingPlaylist: Playlist = {
  ...summerPlaylist,
  id: 'reading-list',
  title: longTitle,
  shortTitle: longTitle,
  artworkUrl: undefined,
  tracks: summerPlaylist.tracks.map((track, index) => ({
    ...track,
    description: index === 0 ? 'A note about the opening song.' : undefined,
  })),
};
const laterMonthlyPlaylist: Playlist = {
  ...summerPlaylist,
  id: 'another-month',
  title: 'Another month of discoveries',
  shortTitle: 'Another month of discoveries',
  artworkUrl: undefined,
};
const singleEntryPlaylist: Playlist = {
  ...readingPlaylist,
  id: 'single-favorite',
  title: 'A single favorite',
  shortTitle: '',
  year: 2024,
  category: 'Features',
  tracks: [readingPlaylist.tracks[0]],
};
const archivePlaylists = [readingPlaylist, collectionPlaylist, laterMonthlyPlaylist, singleEntryPlaylist];

async function openArchive(
  page: Page,
  playlists = archivePlaylists,
  selectedId = playlists[0].id,
) {
  await installAppHarness(page, {
    catalog: { ...browserCatalog, totalPosts: playlists.length, playlists },
  });
  await page.goto(playlistPath(selectedId));
  await expect(page.locator('.playlist-intro h1')).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Open playlist archive', exact: true });
  if (await toggle.isVisible()) {
    await toggle.click();
  }
  const archive = page.getByRole('complementary', { name: 'Playlist archive' });
  await expect(archive).toBeVisible();
  await expect.poll(async () => (await archive.boundingBox())?.x).toBeCloseTo(0);
  return archive;
}

for (const width of [1440, 1100, 901, 390, 320]) {
  test(`keeps reading-list titles complete at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const archive = await openArchive(page);
    const link = archive.locator(`[data-playlist-id="${readingPlaylist.id}"]`);
    const title = link.locator('.archive-card-title');
    await expect(title).toHaveText(longTitle);
    await expect(link).toHaveAttribute('href', playlistPath(readingPlaylist.id));
    await expect(link).toHaveAttribute('aria-current', 'page');

    const metrics = await title.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        height: bounds.height,
        lineHeight: Number.parseFloat(style.lineHeight),
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
        clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
      };
    });
    expect(metrics.height).toBeGreaterThan(metrics.lineHeight * 1.5);
    expect(metrics.whiteSpace).not.toBe('nowrap');
    expect(metrics.textOverflow).not.toBe('ellipsis');
    expect(metrics.clipped).toBe(false);

    const archiveBounds = await archive.boundingBox();
    expect(archiveBounds?.width).toBeCloseTo(width > 900 ? 390 : Math.min(width * 0.9, 390), 1);
    await expect(archive).toHaveCSS('background-color', 'rgb(17, 17, 19)');
    const titleBounds = await title.boundingBox();
    const metadataBounds = await link.locator('.archive-card-meta').boundingBox();
    expect(titleBounds!.y + titleBounds!.height).toBeLessThanOrEqual(metadataBounds!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('groups years once and keeps only useful metadata in each row', async ({ page }) => {
  const archive = await openArchive(page);
  await expect(archive.locator('.year-divider')).toHaveText(['2026', '2025', '2024']);
  const ids = await archive.locator('.archive-playlist-link').evaluateAll((links) => (
    links.map((link) => link.getAttribute('data-playlist-id'))
  ));
  expect(ids).toEqual([
    readingPlaylist.id,
    laterMonthlyPlaylist.id,
    collectionPlaylist.id,
    singleEntryPlaylist.id,
  ]);
  await expect(archive.locator(`[data-playlist-id="${readingPlaylist.id}"] .archive-card-meta > span`))
    .toHaveText(['Monthly Mix', '4 entries', '1 note']);
  await expect(archive.locator(`[data-playlist-id="${singleEntryPlaylist.id}"] .archive-card-meta > span`))
    .toHaveText(['Features', '1 entry', '1 note']);
  await expect(archive.locator(`[data-playlist-id="${singleEntryPlaylist.id}"] .archive-card-title`))
    .toHaveText(singleEntryPlaylist.title);
  await expect(archive.locator(`[data-playlist-id="${laterMonthlyPlaylist.id}"] .archive-card-meta > span`))
    .toHaveText(['Monthly Mix', '4 entries']);
  await expect(archive.locator('.provider-tally, .youtube-dot, .soundcloud-dot')).toHaveCount(0);
  await expect(archive).not.toContainText(/YouTube|SoundCloud|\bYT \d|\bSC \d/);
  await expect(archive.getByRole('link', { name: `Open ${readingPlaylist.title} on billdifferen` }))
    .toHaveAttribute('href', readingPlaylist.sourceUrl);
});

test('keeps search, year, series, count, and filter recovery working', async ({ page }) => {
  const archive = await openArchive(page);
  const search = archive.getByRole('searchbox', { name: 'Search playlists and tracks' });
  const year = archive.getByRole('combobox', { name: 'Filter by year' });
  const series = archive.getByRole('combobox', { name: 'Filter by category' });
  const count = archive.getByRole('status');
  await expect(count).toHaveText('4 playlists');
  await year.selectOption('2025');
  await series.selectOption(collectionPlaylist.category);
  await search.fill('  cloud sequence artist  ');
  await expect(count).toHaveText('1 playlist');
  await expect(archive.locator('.archive-playlist-link')).toHaveCount(1);
  await expect(archive.locator('.archive-playlist-link')).toHaveAttribute('href', playlistPath(collectionPlaylist.id));

  await archive.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(year).toHaveValue('');
  await expect(series).toHaveValue('');
  await expect(count).toHaveText('4 playlists');
  await search.fill('there-is-no-playlist-with-this-title');
  await expect(count).toHaveText('0 playlists');
  await expect(archive.locator('.archive-playlist-link')).toHaveCount(0);
  await archive.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(count).toHaveText('4 playlists');
  await expect(page).toHaveURL(new RegExp(`${playlistPath(readingPlaylist.id)}$`));
  await expect(page.getByRole('button', { name: 'Play playback', exact: true })).toBeVisible();
});

test('keeps tools fixed and reveals the selected row after deep links and history navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const playlists = Array.from({ length: 30 }, (unusedValue, index) => ({
    ...readingPlaylist,
    id: `archive-${index}`,
    title: `Archive selection ${index + 1}: ${longTitle}`,
    shortTitle: `Archive selection ${index + 1}: ${longTitle}`,
  }));
  const selectedPlaylist = playlists.at(-1)!;
  const archive = await openArchive(page, playlists, selectedPlaylist.id);
  const results = archive.locator('.archive-results');
  const tools = archive.locator('.archive-tools');
  const count = archive.locator('.archive-count');
  await expect.poll(async () => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const selectedLink = archive.locator('.archive-playlist-link[aria-current="page"]');
  const resultsBounds = await results.boundingBox();
  const selectedBounds = await selectedLink.boundingBox();
  expect(selectedBounds!.y).toBeGreaterThanOrEqual(resultsBounds!.y);
  expect(selectedBounds!.y + selectedBounds!.height).toBeLessThanOrEqual(resultsBounds!.y + resultsBounds!.height);

  const toolsBefore = await tools.boundingBox();
  const countBefore = await count.boundingBox();
  await results.evaluate((element) => { element.scrollTop = 0; });
  expect(await tools.boundingBox()).toEqual(toolsBefore);
  expect(await count.boundingBox()).toEqual(countBefore);
  await archive.locator(`[data-playlist-id="${playlists[0].id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${playlistPath(playlists[0].id)}$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${playlistPath(selectedPlaylist.id)}$`));
  await expect.poll(async () => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
