import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { Catalog } from '../shared/types.js';
import { generateCatalog, writeCatalogAtomically } from '../scripts/catalog-generation.js';
import { prepareCatalog } from '../scripts/prepare-catalog.js';

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

async function fixtureDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'pilldiff-generation-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('writes a validated live catalog without changing the seed', async (context) => {
  const directory = await fixtureDirectory(context);
  const seedPath = resolve(directory, 'seed.json');
  const outputPath = resolve(directory, 'public/catalog.json');
  const seed = catalog('2024-01-01T00:00:00.000Z', 'Committed seed');
  const fresh = catalog('2024-02-01T00:00:00.000Z', 'Fresh import');
  await writeCatalogAtomically(seedPath, seed);
  const seedBefore = await readFile(seedPath, 'utf8');

  const generated = await prepareCatalog('live', {
    seedPath,
    outputPath,
    importer: async () => fresh,
  });

  assert.deepEqual(generated, fresh);
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), fresh);
  assert.equal(await readFile(seedPath, 'utf8'), seedBefore);
});

test('prepares an offline build from the committed snapshot', async (context) => {
  const directory = await fixtureDirectory(context);
  const seedPath = resolve(directory, 'seed.json');
  const outputPath = resolve(directory, 'public/catalog.json');
  const seed = catalog('2024-01-01T00:00:00.000Z', 'Committed seed');
  await writeCatalogAtomically(seedPath, seed);

  const generated = await prepareCatalog('snapshot', { seedPath, outputPath });

  assert.deepEqual(generated, seed);
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), seed);
});

test('preserves the generated artifact and seed when the importer fails', async (context) => {
  const directory = await fixtureDirectory(context);
  const seedPath = resolve(directory, 'seed.json');
  const outputPath = resolve(directory, 'public/catalog.json');
  const seed = catalog('2024-01-01T00:00:00.000Z', 'Committed seed');
  const generated = catalog('2024-01-15T00:00:00.000Z', 'Generated catalog');
  await writeCatalogAtomically(seedPath, seed);
  await writeCatalogAtomically(outputPath, generated);
  const seedBefore = await readFile(seedPath, 'utf8');
  const outputBefore = await readFile(outputPath, 'utf8');

  await assert.rejects(
    () => generateCatalog(outputPath, async () => {
      throw new Error('upstream unavailable');
    }),
    /upstream unavailable/,
  );

  assert.equal(await readFile(seedPath, 'utf8'), seedBefore);
  assert.equal(await readFile(outputPath, 'utf8'), outputBefore);
});

test('preserves the generated artifact when an imported catalog is invalid', async (context) => {
  const directory = await fixtureDirectory(context);
  const outputPath = resolve(directory, 'public/catalog.json');
  const generated = catalog('2024-01-15T00:00:00.000Z', 'Generated catalog');
  await writeCatalogAtomically(outputPath, generated);
  const outputBefore = await readFile(outputPath, 'utf8');
  const invalid = { ...catalog('2024-02-01T00:00:00.000Z', 'Invalid import'), totalPosts: 0 };

  await assert.rejects(
    () => generateCatalog(outputPath, async () => invalid),
    /Catalog has no source posts/,
  );

  assert.equal(await readFile(outputPath, 'utf8'), outputBefore);
});

test('does not replace a generated artifact when the snapshot is invalid', async (context) => {
  const directory = await fixtureDirectory(context);
  const seedPath = resolve(directory, 'seed.json');
  const outputPath = resolve(directory, 'public/catalog.json');
  const generated = catalog('2024-01-15T00:00:00.000Z', 'Generated catalog');
  await writeCatalogAtomically(outputPath, generated);
  await writeFile(seedPath, '{"schemaVersion":2,"totalPosts":0,"playlists":[]}\n', 'utf8');
  const seedBefore = await readFile(seedPath, 'utf8');
  const outputBefore = await readFile(outputPath, 'utf8');

  await assert.rejects(
    () => prepareCatalog('snapshot', { seedPath, outputPath }),
    /Catalog has no source posts/,
  );

  assert.equal(await readFile(seedPath, 'utf8'), seedBefore);
  assert.equal(await readFile(outputPath, 'utf8'), outputBefore);
});
