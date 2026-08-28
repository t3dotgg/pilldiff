import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import type { Catalog } from '../shared/types.js';
import { CatalogStore, writeCatalogAtomically } from '../server/catalog-store.js';

function catalog(fetchedAt: string, title: string): Catalog {
  return {
    schemaVersion: 2,
    source: { title: 'billdifferen', url: 'https://billdifferen.blogspot.com/' },
    fetchedAt,
    totalPosts: 1,
    playlists: [{
      id: 'post-1',
      title,
      shortTitle: title,
      category: 'Features',
      publishedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      year: 2024,
      sourceUrl: 'https://billdifferen.blogspot.com/post.html',
      tracks: [{
        id: 'track-1',
        provider: 'youtube',
        title: 'Song',
        artist: 'Artist',
        label: 'Artist - Song',
        sourceUrl: 'https://www.youtube.com/watch?v=0VNQ4GemnCY',
        playbackUrl: 'https://www.youtube.com/embed/0VNQ4GemnCY',
        videoId: '0VNQ4GemnCY',
        position: 1,
        kind: 'track',
      }],
      skipped: { bandcamp: 0, other: 0 },
    }],
  };
}

test('preserves the known-good cache when refresh fails', async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pilldiff-store-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const seedPath = resolve(directory, 'seed.json');
  const cachePath = resolve(directory, 'cache.json');
  const seed = catalog('2024-01-01T00:00:00.000Z', 'Known good');
  await writeCatalogAtomically(seedPath, seed);
  const store = new CatalogStore({
    seedPath,
    cachePath,
    now: () => new Date('2024-01-02T00:00:00.000Z'),
    importer: async () => {
      throw new Error('partial pagination');
    },
  });
  const response = await store.refresh();
  assert.equal(response.catalog.playlists[0].title, 'Known good');
  assert.equal(response.stale, true);
  assert.match(response.warning ?? '', /partial pagination/);
  await assert.rejects(() => readFile(cachePath, 'utf8'));
});

test('deduplicates simultaneous refreshes and writes only the valid result', async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pilldiff-store-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const seedPath = resolve(directory, 'seed.json');
  const cachePath = resolve(directory, 'cache.json');
  await writeCatalogAtomically(seedPath, catalog('2024-01-01T00:00:00.000Z', 'Seed'));
  let imports = 0;
  const fresh = catalog('2024-01-02T00:00:00.000Z', 'Fresh');
  const store = new CatalogStore({
    seedPath,
    cachePath,
    now: () => new Date('2024-01-02T01:00:00.000Z'),
    importer: async () => {
      imports += 1;
      await Promise.resolve();
      return fresh;
    },
  });
  const [first, second] = await Promise.all([store.refresh(), store.refresh()]);
  assert.equal(imports, 1);
  assert.equal(first.catalog.playlists[0].title, 'Fresh');
  assert.equal(second.catalog.playlists[0].title, 'Fresh');
  assert.deepEqual(JSON.parse(await readFile(cachePath, 'utf8')), fresh);
});

test('bootstraps from refresh when no disk snapshot is valid', async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pilldiff-store-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const seedPath = resolve(directory, 'missing-seed.json');
  const cachePath = resolve(directory, 'cache.json');
  const fresh = catalog('2024-01-02T00:00:00.000Z', 'Recovered');
  const store = new CatalogStore({ seedPath, cachePath, importer: async () => fresh });
  const response = await store.refresh();
  assert.equal(response.catalog.playlists[0].title, 'Recovered');
  assert.deepEqual(JSON.parse(await readFile(cachePath, 'utf8')), fresh);
});

test('surfaces refresh failure when no disk snapshot is valid', async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pilldiff-store-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new CatalogStore({
    seedPath: resolve(directory, 'missing-seed.json'),
    cachePath: resolve(directory, 'missing-cache.json'),
    importer: async () => {
      throw new Error('upstream unavailable');
    },
  });
  await assert.rejects(() => store.refresh(), /no valid catalog.*upstream unavailable/i);
});

test('ignores a newer legacy cache in favor of the seed with song descriptions', async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pilldiff-store-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const seedPath = resolve(directory, 'seed.json');
  const cachePath = resolve(directory, 'cache.json');
  const seed = catalog('2024-01-01T00:00:00.000Z', 'Enriched seed');
  seed.playlists[0].tracks[0].description = 'A note about this particular song.';
  await writeCatalogAtomically(seedPath, seed);
  const legacy = { ...catalog('2024-02-01T00:00:00.000Z', 'Legacy cache'), schemaVersion: 1 };
  await writeFile(cachePath, JSON.stringify(legacy));
  const store = new CatalogStore({ seedPath, cachePath });
  const response = await store.get();
  assert.equal(response.catalog.schemaVersion, 2);
  assert.equal(response.catalog.playlists[0].tracks[0].description, seed.playlists[0].tracks[0].description);
});
