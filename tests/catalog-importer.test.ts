import assert from 'node:assert/strict';
import test from 'node:test';
import type { BloggerEntry } from '../server/importer.js';
import { importCatalog, parsePost, parseSupportedMedia } from '../server/importer.js';

function entry(title: string, content: string, id = '1'): BloggerEntry {
  return {
    id: { $t: `tag:blogger.com,1999:blog-1.post-${id}` },
    title: { $t: title },
    published: { $t: '2024-01-02T00:00:00.000Z' },
    updated: { $t: '2024-01-03T00:00:00.000Z' },
    content: { $t: content },
    link: [{ rel: 'alternate', href: `https://billdifferen.blogspot.com/2024/01/${id}.html` }],
  };
}

test('extracts artists from singly spaced hyphens and fully spaced Unicode dashes', () => {
  const examples = [
    { label: 'Artist - Song', artist: 'Artist', title: 'Song' },
    { label: 'Artist- Song', artist: 'Artist', title: 'Song' },
    { label: 'Artist -Song', artist: 'Artist', title: 'Song' },
    { label: 'Artist – Song', artist: 'Artist', title: 'Song' },
    { label: 'Artist — Song', artist: 'Artist', title: 'Song' },
    { label: 'Artist-Name- Post-punk Song', artist: 'Artist-Name', title: 'Post-punk Song' },
  ];
  for (const expected of examples) {
    const playlist = parsePost(entry("billdifferen's top songs of 2024", `
      <h1>1. <a href="https://soundcloud.com/artist/song">${expected.label}</a></h1>
    `));
    assert.ok(playlist);
    assert.equal(playlist.tracks.length, 1);
    const { label, artist, title } = playlist.tracks[0];
    assert.deepEqual({ label, artist, title }, expected, expected.label);
  }
});

test('preserves word hyphens, repeated dashes, and one-sided Unicode attribution', () => {
  const labels = [
    'Artist-Song',
    'Artist -- Song',
    'Artist-- Song',
    'Artist ---Song',
    "NEGRO 5 ESTRELLAS --V-- ELLA TA' --V-- REMISERIA TEMPERLEY X CIAN ZANGOLOTEO 140 BPM EDIT",
    'Artist– Song',
    'Artist —Song',
    'Happy Goat y3ar!!!🐐🐐🐐🐐 pic.twitter.com/xLH9hje9kg— YungD1s3 (@YungD1se) January 1, 2022',
    '- Song',
  ];
  for (const label of labels) {
    const playlist = parsePost(entry("billdifferen's top songs of 2024", `
      <h1>1. <a href="https://soundcloud.com/artist/song">${label}</a></h1>
    `));
    assert.ok(playlist);
    assert.equal(playlist.tracks.length, 1);
    assert.equal(playlist.tracks[0].label, label);
    assert.equal(playlist.tracks[0].artist, '', label);
    assert.equal(playlist.tracks[0].title, label);
  }
});

test('extracts mixed providers in document order and pairs official embeds', () => {
  const playlist = parsePost(entry('billdifferen\'s favorite music of july 2024', `
    <h2>3. <a href="https://www.youtube.com/watch?v=0VNQ4GemnCY">Untold - Bluebells</a></h2>
    <div><iframe src="https://www.youtube.com/embed/0VNQ4GemnCY"></iframe></div>
    <h2>2. <a href="https://soundcloud.com/yuke/codependent">yuke - codependent</a></h2>
    <div><iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2Fsoundcloud%253Atracks%253A2362510124"></iframe></div>
    <h2>1. Mystery selection</h2>
    <div><iframe src="https://www.youtube.com/embed/qjIIxuV6DS0"></iframe></div>
  `));
  assert.ok(playlist);
  assert.equal(playlist.shortTitle, 'July 2024');
  assert.equal(playlist.tracks.length, 3);
  assert.deepEqual(playlist.tracks.map((track) => track.provider), ['youtube', 'soundcloud', 'youtube']);
  assert.equal(playlist.tracks[1].sourceUrl, 'https://soundcloud.com/yuke/codependent');
  assert.equal(playlist.tracks[1].playbackUrl, 'https://api.soundcloud.com/tracks/2362510124');
  assert.deepEqual(playlist.tracks.map((track) => track.position), [1, 2, 3]);
});

test('pairs a cross-provider heading and embed as one ranked entry', () => {
  const playlist = parsePost(entry('billdifferen\'s top songs of 2024', `
    <h1>1. Artist - Cross-provider song</h1>
    <h2><a href="https://www.youtube.com/watch?v=0VNQ4GemnCY">YOUTUBE</a></h2>
    <div><iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F2362510124"></iframe></div>
    <div style="color: #cccccc; font-size: 10px"><a title="Cross-provider song" href="https://soundcloud.com/artist/cross-provider-song">Cross-provider song</a></div>
  `));
  assert.ok(playlist);
  assert.equal(playlist.tracks.length, 1);
  assert.equal(playlist.tracks[0].provider, 'soundcloud');
  assert.equal(playlist.tracks[0].label, 'Artist - Cross-provider song');
  assert.equal(playlist.tracks[0].sourceUrl, 'https://soundcloud.com/artist/cross-provider-song');
  assert.equal(playlist.tracks[0].playbackUrl, 'https://api.soundcloud.com/tracks/2362510124');
});

test('pairs distinct SoundCloud songs inside one ranked Blogger heading', () => {
  const earlierTracks = Array.from({ length: 49 }, (unusedValue, index) => {
    const rank = 52 - index;
    return `<h1>${rank}. <a href="https://soundcloud.com/artist/song-${rank}">Artist - Song ${rank}</a></h1>`;
  }).join('');
  const playlist = parsePost(entry("billdifferen's top 100 songs of 2025 (part 1: 50-1)", `
    ${earlierTracks}
    <h1>
      3.
      <a href="https://soundcloud.com/snoa247/agenda-prod-olswel">snoa- Agenda [Olswel]</a>
      /
      <a href="https://soundcloud.com/snoa247/hearmenow">hear me now [444jet, chinapoet]</a>
      <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2Fsoundcloud%253Atracks%253A2099816094"></iframe>
      <div style="color: #cccccc; font-size: 10px"></div>
      <div style="color: #cccccc; font-size: 10px"></div>
      <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2Fsoundcloud%253Atracks%253A2128892289"></iframe>
    </h1>
    <p>Two sides of the same late-night thought.</p>
    <h1>2. <a href="https://losthuthanaka.bandcamp.com/track/parrandita-sariri-tunupa-4">Los Thuthanaka - Parrandita “Sariri Tunupa”</a></h1>
  `, '4187003885016673397'));
  assert.ok(playlist);
  assert.equal(playlist.tracks.length, 51);
  assert.equal(playlist.skipped.bandcamp, 1);
  assert.deepEqual(
    playlist.tracks.slice(-2).map((track) => ({
      id: track.id,
      label: track.label,
      artist: track.artist,
      title: track.title,
      sourceUrl: track.sourceUrl,
      playbackUrl: track.playbackUrl,
      rank: track.rank,
      position: track.position,
      description: track.description,
    })),
    [
      {
        id: '19ba6938fb86df849711',
        label: 'snoa- Agenda [Olswel]',
        artist: 'snoa',
        title: 'Agenda [Olswel]',
        sourceUrl: 'https://soundcloud.com/snoa247/agenda-prod-olswel',
        playbackUrl: 'https://api.soundcloud.com/tracks/2099816094',
        rank: 3,
        position: 50,
        description: 'Two sides of the same late-night thought.',
      },
      {
        id: '92a97c201d809e8747bf',
        label: 'hear me now [444jet, chinapoet]',
        artist: 'snoa',
        title: 'hear me now [444jet, chinapoet]',
        sourceUrl: 'https://soundcloud.com/snoa247/hearmenow',
        playbackUrl: 'https://api.soundcloud.com/tracks/2128892289',
        rank: 3,
        position: 51,
        description: 'Two sides of the same late-night thought.',
      },
    ],
  );
});

test('shares only unambiguous preceding artists with matching SoundCloud profiles', () => {
  const examples = [
    {
      name: 'case-normalized names preserve explicit spelling and never propagate backwards',
      songs: [
        { url: 'https://soundcloud.com/profile/first', label: 'First song' },
        { url: 'https://soundcloud.com/profile/second', label: 'Artist - Second song' },
        { url: 'https://soundcloud.com/profile/third', label: 'ARTIST - Third song' },
        { url: 'https://soundcloud.com/profile/fourth', label: 'Fourth song' },
      ],
      artists: ['', 'Artist', 'ARTIST', 'ARTIST'],
    },
    {
      name: 'different creator profiles do not share attribution',
      songs: [
        { url: 'https://soundcloud.com/profile/first', label: 'Artist - First song' },
        { url: 'https://soundcloud.com/other-profile/second', label: 'Second song' },
      ],
      artists: ['Artist', ''],
    },
    {
      name: 'conflicting explicit artists prevent inheritance',
      songs: [
        { url: 'https://soundcloud.com/profile/first', label: 'Artist - First song' },
        { url: 'https://soundcloud.com/profile/second', label: 'Other Artist - Second song' },
        { url: 'https://soundcloud.com/profile/third', label: 'Third song' },
      ],
      artists: ['Artist', 'Other Artist', ''],
    },
    {
      name: 'numeric API URLs do not identify a creator',
      songs: [
        { url: 'https://api.soundcloud.com/tracks/2099816094', label: 'Artist - First song' },
        { url: 'https://api.soundcloud.com/tracks/2128892289', label: 'Second song' },
      ],
      artists: ['Artist', ''],
    },
    {
      name: 'profile handles alone do not supply artist names',
      songs: [
        { url: 'https://soundcloud.com/profile/first', label: 'First song' },
        { url: 'https://soundcloud.com/profile/second', label: 'Second song' },
      ],
      artists: ['', ''],
    },
    {
      name: 'YouTube links do not establish shared creator ownership',
      songs: [
        { url: 'https://www.youtube.com/watch?v=0VNQ4GemnCY', label: 'Artist - First song' },
        { url: 'https://www.youtube.com/watch?v=qjIIxuV6DS0', label: 'Second song' },
      ],
      artists: ['Artist', ''],
    },
  ];
  for (const example of examples) {
    const anchors = example.songs.map((song) => `<a href="${song.url}">${song.label}</a>`).join(' / ');
    const embeds = example.songs.map((song) => {
      const media = parseSupportedMedia(song.url);
      assert.ok(media);
      const embedUrl = media.provider === 'soundcloud'
        ? `https://w.soundcloud.com/player/?url=${encodeURIComponent(media.playbackUrl)}`
        : media.playbackUrl;
      return `<iframe src="${embedUrl}"></iframe>`;
    }).join('');
    const playlist = parsePost(entry("billdifferen's top songs of 2024", `<h1>3. ${anchors}${embeds}</h1>`));
    assert.ok(playlist);
    assert.equal(playlist.tracks.length, example.songs.length, example.name);
    assert.deepEqual(playlist.tracks.map((track) => track.label), example.songs.map((song) => song.label), example.name);
    assert.deepEqual(playlist.tracks.map((track) => track.artist), example.artists, example.name);
  }
});

test('does not inherit artists across separate blocks or ranks', () => {
  const playlist = parsePost(entry("billdifferen's top songs of 2024", `
    <h1>3. <a href="https://soundcloud.com/profile/first">Artist - First song</a>
      <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fprofile%2Ffirst"></iframe>
    </h1>
    <h1>3. <a href="https://soundcloud.com/profile/second">Second song</a>
      <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fprofile%2Fsecond"></iframe>
    </h1>
    <h1>2. <a href="https://soundcloud.com/profile/third">Third song</a>
      <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fprofile%2Fthird"></iframe>
    </h1>
  `));
  assert.ok(playlist);
  assert.deepEqual(playlist.tracks.map((track) => ({ rank: track.rank, artist: track.artist, title: track.title })), [
    { rank: 3, artist: 'Artist', title: 'First song' },
    { rank: 3, artist: '', title: 'Second song' },
    { rank: 2, artist: '', title: 'Third song' },
  ]);
});

test('prefers exact media identity when shared-entry embeds are reversed', () => {
  const playlist = parsePost(entry("billdifferen's top songs of 2024", `
    <h1>
      1.
      <a href="https://www.youtube.com/watch?v=0VNQ4GemnCY">Artist - First / Reprise</a>
      /
      <a href="https://www.youtube.com/watch?v=qjIIxuV6DS0">Artist - Second</a>
      <iframe src="https://www.youtube.com/embed/qjIIxuV6DS0"></iframe>
      <iframe src="https://www.youtube.com/embed/0VNQ4GemnCY"></iframe>
    </h1>
  `));
  assert.ok(playlist);
  assert.deepEqual(
    playlist.tracks.map((track) => ({ label: track.label, sourceUrl: track.sourceUrl, playbackUrl: track.playbackUrl, rank: track.rank })),
    [
      {
        label: 'Artist - First / Reprise',
        sourceUrl: 'https://www.youtube.com/watch?v=0VNQ4GemnCY',
        playbackUrl: 'https://www.youtube.com/embed/0VNQ4GemnCY',
        rank: 1,
      },
      {
        label: 'Artist - Second',
        sourceUrl: 'https://www.youtube.com/watch?v=qjIIxuV6DS0',
        playbackUrl: 'https://www.youtube.com/embed/qjIIxuV6DS0',
        rank: 1,
      },
    ],
  );
});

test('keeps every embed when a shared-entry group cannot pair completely', () => {
  const playlist = parsePost(entry("billdifferen's top songs of 2024", `
    <h1>
      3.
      <a href="https://soundcloud.com/artist/first">Artist - First</a>
      /
      <a href="https://www.youtube.com/watch?v=0VNQ4GemnCY">Artist - Second</a>
      /
      <a href="https://soundcloud.com/artist/third">Artist - Third</a>
      <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F2099816094"></iframe>
      <iframe src="https://www.youtube.com/embed/0VNQ4GemnCY"></iframe>
    </h1>
  `));
  assert.ok(playlist);
  assert.equal(playlist.tracks.length, 2);
  assert.deepEqual(playlist.tracks.map((track) => track.playbackUrl), [
    'https://api.soundcloud.com/tracks/2099816094',
    'https://www.youtube.com/embed/0VNQ4GemnCY',
  ]);
});

test('stops legacy pairing before a complete nested shared-entry group', () => {
  const playlist = parsePost(entry("billdifferen's top songs of 2024", `
    <div>
      3. <a href="https://soundcloud.com/artist/outer">Artist - Outer</a>
      <h1>
        3.
        <a href="https://www.youtube.com/watch?v=0VNQ4GemnCY">Artist - First</a>
        /
        <a href="https://www.youtube.com/watch?v=qjIIxuV6DS0">Artist - Second</a>
        <iframe src="https://www.youtube.com/embed/0VNQ4GemnCY"></iframe>
        <iframe src="https://www.youtube.com/embed/qjIIxuV6DS0"></iframe>
      </h1>
      <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F300"></iframe>
    </div>
  `));
  assert.ok(playlist);
  assert.equal(playlist.tracks.length, 4);
  assert.deepEqual(playlist.tracks.map((track) => track.playbackUrl), [
    'https://soundcloud.com/artist/outer',
    'https://www.youtube.com/embed/0VNQ4GemnCY',
    'https://www.youtube.com/embed/qjIIxuV6DS0',
    'https://api.soundcloud.com/tracks/300',
  ]);
  assert.deepEqual(playlist.tracks.slice(1, 3).map((track) => track.label), [
    'Artist - First',
    'Artist - Second',
  ]);
});

test('keeps immediately adjacent distinct anchors separate when both embeds match', () => {
  const playlist = parsePost(entry("billdifferen's top songs of 2024", `
    <h1>
      3.
      <a href="https://www.youtube.com/watch?v=0VNQ4GemnCY">Artist - First</a><a href="https://www.youtube.com/watch?v=qjIIxuV6DS0">Artist - Second</a>
      <iframe src="https://www.youtube.com/embed/0VNQ4GemnCY"></iframe>
      <iframe src="https://www.youtube.com/embed/qjIIxuV6DS0"></iframe>
    </h1>
  `));
  assert.ok(playlist);
  assert.deepEqual(
    playlist.tracks.map((track) => ({ label: track.label, playbackUrl: track.playbackUrl })),
    [
      { label: 'Artist - First', playbackUrl: 'https://www.youtube.com/embed/0VNQ4GemnCY' },
      { label: 'Artist - Second', playbackUrl: 'https://www.youtube.com/embed/qjIIxuV6DS0' },
    ],
  );
});

test('excludes contextual album links from a ranked song playlist', () => {
  const playlist = parsePost(entry('billdifferen\'s top songs of 2024', `
    <h2>Notable Releases: <a href="https://soundcloud.com/artist/sets/context-album">Context album</a></h2>
    <p>Related listening includes <a href="https://www.youtube.com/playlist?list=PL1234567890abcdef">another album</a>.</p>
    <h2>1. <a href="https://www.youtube.com/watch?v=0VNQ4GemnCY">Artist - Ranked song</a></h2>
    <div><iframe src="https://www.youtube.com/embed/0VNQ4GemnCY"></iframe></div>
  `));
  assert.ok(playlist);
  assert.equal(playlist.tracks.length, 1);
  assert.equal(playlist.tracks[0].label, 'Artist - Ranked song');
});

test('uses the nearest ranked heading instead of a long enclosing iframe wrapper', () => {
  const longReview = Array.from({ length: 60 }, () => 'commentary').join(' ');
  const playlist = parsePost(entry('billdifferen\'s top 99 baile funk songs of 2022', `
    <h1>99. <a href="https://soundcloud.com/artist/song-99">Artist - Song 99</a></h1>
    <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F9900"></iframe>
    <p>${longReview}</p>
    <h1>98. <a href="https://soundcloud.com/artist/work-rihanna">WORK - RIHANNA FT. DJ NATTAN</a></h1>
    <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F9800"></iframe>
    <p>${longReview}</p>
  `));
  assert.ok(playlist);
  assert.equal(playlist.tracks.length, 2);
  assert.deepEqual(playlist.tracks.map((track) => track.rank), [99, 98]);
  assert.equal(playlist.tracks[1].label, 'WORK - RIHANNA FT. DJ NATTAN');
  assert.equal(playlist.tracks[1].playbackUrl, 'https://api.soundcloud.com/tracks/9800');
});

test('lets an immediately adjacent ranked entry override stale iframe context', () => {
  const playlist = parsePost(entry('WE IN JERSEY RIGHT NOW', `
    <h2>2. Earlier heading</h2>
    <div>1. <a href="https://soundcloud.com/artist/final-song">Artist - Final song</a></div>
    <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F1001"></iframe>
  `));
  assert.ok(playlist);
  assert.equal(playlist.tracks.length, 1);
  assert.equal(playlist.tracks[0].rank, 1);
  assert.equal(playlist.tracks[0].label, 'Artist - Final song');
  assert.equal(playlist.tracks[0].playbackUrl, 'https://api.soundcloud.com/tracks/1001');
});

test('inherits album identity for multi-platform release rows', () => {
  const playlist = parsePost(entry('billdifferen\'s top 100 releases of 2021', `
    <h2>97. BBY GOYARD - The Secret Lies With Charlotte 2</h2>
    <h3>(cloud rap)</h3>
    <h3><a href="https://open.spotify.com/album/example">Spotify</a> | <a href="https://music.apple.com/album/example">Apple Music</a> | <a href="https://soundcloud.com/bbygoyard/sets/the-secret-lies-with-1">Soundcloud</a></h3>
    <h2>93. Bladee - The Fool</h2>
    <h3>(pop rap)</h3>
    <h3><a href="https://soundcloud.com/bladee/sets/the-fool">Soundcloud</a> | <a href="https://open.spotify.com/album/another">Spotify</a></h3>
  `));
  assert.ok(playlist);
  assert.equal(playlist.tracks.length, 2);
  assert.deepEqual(playlist.tracks.map((track) => track.rank), [97, 93]);
  assert.deepEqual(playlist.tracks.map((track) => track.label), [
    'BBY GOYARD - The Secret Lies With Charlotte 2',
    'Bladee - The Fool',
  ]);
  assert.deepEqual(playlist.tracks.map((track) => track.kind), ['playlist', 'playlist']);
});

test('merges split labels but preserves repeated placements at different ranks', () => {
  const soundCloudUrl = 'https://soundcloud.com/example/the-track';
  const playlist = parsePost(entry('billdifferen\'s top songs of 2024', `
    <div>2. <a href="${soundCloudUrl}">Artist -</a></div>
    <div><a href="${soundCloudUrl}">Track title</a></div>
    <div>1. <a href="${soundCloudUrl}">Artist - Track reprise</a></div>
  `));
  assert.ok(playlist);
  assert.equal(playlist.tracks.length, 2);
  assert.equal(playlist.tracks[0].label, 'Artist - Track title');
  assert.deepEqual(playlist.tracks.map((track) => track.rank), [2, 1]);
});

test('normalizes malformed and private provider links safely', () => {
  const bareYouTube = parseSupportedMedia(' www.youtube.com/watch?v=3CT8RSXA_HY ');
  assert.equal(bareYouTube?.videoId, '3CT8RSXA_HY');
  const privateLink = parseSupportedMedia('https://soundcloud.com/artist/song/s-secret?secret_token=s-private&utm_source=copy');
  assert.equal(privateLink?.playbackUrl, 'https://soundcloud.com/artist/song/s-secret?secret_token=s-private');
  const nestedTarget = encodeURIComponent('https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A2362510124?secret_token=s-token');
  const encodedEmbed = parseSupportedMedia(`https://w.soundcloud.com/player/?url=${nestedTarget}`);
  assert.equal(encodedEmbed?.playbackUrl, 'https://api.soundcloud.com/tracks/2362510124?secret_token=s-token');
});

test('counts Bandcamp once, skips it, and retains curated playlists', () => {
  const playlist = parsePost(entry('billdifferen\'s top releases of 2024', `
    <h2>3. <a href="https://artist.bandcamp.com/track/song">Bandcamp song</a></h2>
    <div><iframe src="https://bandcamp.com/EmbeddedPlayer/track=1"></iframe></div>
    <h2>2. <a href="https://soundcloud.com/artist/sets/album">Artist - Album</a></h2>
    <h2>1. <a href="https://www.youtube.com/playlist?list=PL1234567890abcdef">Artist - Videos</a></h2>
  `));
  assert.ok(playlist);
  assert.equal(playlist.skipped.bandcamp, 1);
  assert.equal(playlist.tracks.length, 2);
  assert.deepEqual(playlist.tracks.map((track) => track.kind), ['playlist', 'playlist']);
});

test('handles nested headings, unlinked embeds, and an aggregate set', () => {
  const rankedLinks = Array.from({ length: 20 }, (unusedValue, index) => {
    const rank = 20 - index;
    return `<div>${rank}. <a href="https://soundcloud.com/artist/song-${rank}">Artist - Song ${rank}</a></div>`;
  }).join('');
  const playlist = parsePost(entry('billdifferen\'s top 20 songs of 2024', `
    <h1><section><div>Bonus</div><div><iframe src="https://www.youtube.com/embed/0VNQ4GemnCY"></iframe></div></section></h1>
    <p><iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Fplaylists%2F1941495591"></iframe></p>
    ${rankedLinks}
  `));
  assert.ok(playlist);
  assert.equal(playlist.tracks.length, 21);
  assert.equal(playlist.tracks[0].videoId, '0VNQ4GemnCY');
  assert.equal(playlist.tracks.some((track) => track.playlistId === '1941495591'), false);
});

test('paginates to the reported total beyond the first page', async () => {
  const entries = Array.from({ length: 27 }, (unusedValue, index) => entry(`Post ${index + 1}`, `<h2>1. <a href="https://youtu.be/0VNQ4GemnCY">Artist - Song</a></h2>`, String(index + 1)));
  const starts: number[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const start = Number(url.searchParams.get('start-index'));
    const pageSize = Number(url.searchParams.get('max-results'));
    starts.push(start);
    return Response.json({
      feed: {
        entry: entries.slice(start - 1, start - 1 + pageSize),
        openSearch$totalResults: { $t: String(entries.length) },
      },
    });
  };
  const catalog = await importCatalog({ fetchImpl, pageSize: 25, now: new Date('2024-02-01T00:00:00.000Z') });
  assert.deepEqual(starts, [1, 26]);
  assert.equal(catalog.totalPosts, 27);
  assert.equal(catalog.playlists.length, 27);
});

test('rejects a partial paginated snapshot', async () => {
  const firstPage = Array.from({ length: 25 }, (unusedValue, index) => entry(`Post ${index + 1}`, `<h2>1. <a href="https://youtu.be/0VNQ4GemnCY">Artist - Song</a></h2>`, String(index + 1)));
  const fetchImpl: typeof fetch = async (input) => {
    const start = Number(new URL(String(input)).searchParams.get('start-index'));
    if (start === 1) {
      return Response.json({ feed: { entry: firstPage, openSearch$totalResults: { $t: '27' } } });
    }
    return new Response('upstream failed', { status: 503 });
  };
  await assert.rejects(() => importCatalog({ fetchImpl }), /Blogger returned 503/);
});
