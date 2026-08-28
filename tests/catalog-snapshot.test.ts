import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Catalog } from '../shared/types.js';
import { validateCatalog } from '../server/importer.js';

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('checked seed retains audited live archive coverage', async () => {
  const catalog = JSON.parse(await readFile(resolve(rootDirectory, 'data/catalog.json'), 'utf8')) as Catalog;
  validateCatalog(catalog);
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.totalPosts, 40);
  assert.equal(catalog.playlists.length, 39);
  assert.equal(catalog.playlists.reduce((total, playlist) => total + playlist.tracks.length, 0), 2189);
  assert.ok(catalog.playlists.flatMap((playlist) => playlist.tracks).filter((track) => track.description).length > 1200);

  const byTitle = new Map(catalog.playlists.map((playlist) => [playlist.title, playlist]));
  const july = byTitle.get("billdifferen's favorite music of july 2026");
  const june = byTitle.get("billdifferen's favorite music of june 2026 (plus favorite albums from may & june)");
  const may = byTitle.get("billdifferen's favorite music of may 2026");
  const april = byTitle.get("billdifferen's favorite music of april 2026 (plus march & april albums)");
  const february = byTitle.get("billdifferen's favorite music of february 2026");
  const late2025 = byTitle.get("billdifferen's top 100 songs of 2025 (part 1: 100-51)");
  const jersey = byTitle.get("billdifferen's top 100 jersey club tunes of 2024");
  const funk = byTitle.get("billdifferen's top 100 funk songs of 2024");
  const starterKit = byTitle.get("billdifferen's #JerseyClub Starter Kit 2k24");
  const jerseyGuide = byTitle.get('WE IN JERSEY RIGHT NOW #2 - A Look at the My Favorite Jersey Club Songs of 2023 So Far');
  const baileFunk = byTitle.get("billdifferen's top 99 baile funk songs of 2022");
  const releases2021 = byTitle.get("billdifferen's top 100 releases of 2021");

  assert.equal(july?.tracks.length, 50);
  assert.ok(july?.tracks.every((track) => track.description === undefined));
  assert.equal(june?.tracks.length, 50);
  assert.equal(may?.tracks.length, 48);
  assert.equal(may?.skipped.bandcamp, 2);
  assert.equal(april?.tracks.length, 50);
  assert.equal(february?.tracks.length, 51);
  assert.equal(late2025?.tracks.length, 52);
  assert.equal(jersey?.tracks.length, 100);
  assert.equal(funk?.tracks.length, 100);
  assert.equal(starterKit?.tracks.length, 90);
  assert.equal(jerseyGuide?.tracks.length, 40);
  assert.equal(baileFunk?.tracks.length, 94);
  assert.equal(releases2021?.tracks.length, 52);
  assert.equal(releases2021?.skipped.bandcamp, 54);
  assert.equal(releases2021?.tracks[0].description, undefined);
  assert.match(releases2021?.tracks.find((track) => track.rank === 97)?.description ?? '', /^\(.+\)$/);
  const releases2022 = byTitle.get("billdifferen's top 100 releases of 2022");
  assert.match(releases2022?.tracks.find((track) => track.rank === 99)?.description ?? '', /^\[.+\]\n\nMust Listen:/);
  assert.deepEqual(jerseyGuide?.tracks.map((track) => track.rank), Array.from({ length: 40 }, (unusedValue, index) => 40 - index));
  assert.deepEqual(
    baileFunk?.tracks.map((track) => track.rank),
    Array.from({ length: 99 }, (unusedValue, index) => 99 - index).filter((rank) => ![85, 75, 69, 40, 21].includes(rank)),
  );
  assert.deepEqual(
    baileFunk?.tracks.filter((track) => track.rank === 98).map((track) => ({
      label: track.label,
      playbackUrl: track.playbackUrl,
    })),
    [{
      label: 'WORK - RIHANNA FT. DJ NATTAN',
      playbackUrl: 'https://api.soundcloud.com/tracks/1373881369',
    }],
  );
  assert.deepEqual(
    releases2021?.tracks.filter((track) => [97, 93, 91].includes(track.rank ?? -1)).map((track) => ({ rank: track.rank, label: track.label, kind: track.kind })),
    [
      { rank: 97, label: 'BBY GOYARD - The Secret Lies With Charlotte 2', kind: 'playlist' },
      { rank: 93, label: 'Bladee - The Fool', kind: 'playlist' },
      { rank: 91, label: 'Duke Deuce - Duke Nukem', kind: 'playlist' },
    ],
  );

  assert.deepEqual(
    july?.tracks.slice(0, 2).map((track) => ({ rank: track.rank, label: track.label, sourceUrl: track.sourceUrl, playbackUrl: track.playbackUrl })),
    [
      {
        rank: 50,
        label: 'Untold (London) - Last Day of the Bluebells',
        sourceUrl: 'https://www.youtube.com/watch?v=0VNQ4GemnCY',
        playbackUrl: 'https://www.youtube.com/embed/0VNQ4GemnCY',
      },
      {
        rank: 49,
        label: 'yuke (New York City) - codependent [st47ic]',
        sourceUrl: 'https://soundcloud.com/yuke/codependent',
        playbackUrl: 'https://api.soundcloud.com/tracks/2362510124',
      },
    ],
  );
});
