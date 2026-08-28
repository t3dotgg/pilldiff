import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePost, validateCatalog } from '../server/importer.js';

function parse(content: string, title = 'Top songs of 2024') {
  const playlist = parsePost({
    id: { $t: 'tag:blogger.com,1999:blog-1.post-1' },
    title: { $t: title },
    published: { $t: '2024-01-02T00:00:00.000Z' },
    updated: { $t: '2024-01-03T00:00:00.000Z' },
    content: { $t: content },
  });
  assert.ok(playlist);
  return playlist;
}

test('collects notes before and after paired embeds without neighboring reviews', () => {
  const playlist = parse(`
    <p>An introduction to the entire list.</p>
    <h1>2. <a href="https://youtu.be/0VNQ4GemnCY">Artist - First song</a></h1>
    <p>A note before the player.</p>
    <iframe src="https://www.youtube.com/embed/0VNQ4GemnCY"></iframe>
    <div>A second paragraph with <b>emphasis</b> and <a href="https://example.com/context">context</a>.</div>
    <h1>1. <a href="https://soundcloud.com/artist/second">Artist - Second song</a></h1>
    <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F200"></iframe>
    <div>A different review.</div>
    <h2>Further listening</h2>
    <p>This is not a review of the second song.</p>
  `);
  assert.equal(playlist.tracks.length, 2);
  assert.equal(playlist.tracks[0].description, 'A note before the player.\n\nA second paragraph with emphasis and context.');
  assert.equal(playlist.tracks[1].description, 'A different review.');
});

test('excludes provider attribution, executable markup, and hidden content', () => {
  const playlist = parse(`
    <h1>1. Artist - SoundCloud song</h1>
    <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F200"></iframe>
    <div style="color: #cccccc; font-size: 10px"><a href="https://soundcloud.com/artist/song">Widget attribution</a></div>
    <div>A <i>lovely</i> tune &amp; a great finish.<br>Another line.</div>
    <script>alert('not a note')</script><style>body { color: green }</style>
    <p hidden>Hidden text</p><p style="display: none">Hidden too</p>
    <p aria-hidden="true">Not visible</p>
  `);
  assert.equal(playlist.tracks[0].description, 'A lovely tune & a great finish.\n\nAnother line.');
  assert.doesNotMatch(playlist.tracks[0].description!, /<|Widget|Hidden|alert/);
});

test('stops notes at unsupported Bandcamp and Spotify-only entries', () => {
  const playlist = parse(`
    <h2>4. <a href="https://youtu.be/0VNQ4GemnCY">Artist - First</a></h2>
    <p>Only the first song.</p>
    <h2>3. <a href="https://artist.bandcamp.com/track/missing">Artist - Skipped</a></h2>
    <p>About a Bandcamp-only song.</p>
    <iframe src="https://bandcamp.com/EmbeddedPlayer/track=1"></iframe>
    <h2>2. Spotify-only album</h2><h3>(a different review)</h3>
    <h3><a href="https://open.spotify.com/album/123">Spotify</a></h3>
    <h2>1. <a href="https://youtu.be/qjIIxuV6DS0">Artist - Last</a></h2>
    <p>Only the last song.</p>
  `);
  assert.deepEqual(playlist.tracks.map((track) => track.description), ['Only the first song.', 'Only the last song.']);
});

test('stops notes at an unranked skipped link and unknown embed', () => {
  const playlist = parse(`
    <h2>2. <a href="https://youtu.be/0VNQ4GemnCY">Artist - First</a></h2>
    <p>Keep this note.</p>
    <p><a href="https://artist.bandcamp.com/track/missing">A Bandcamp selection</a></p>
    <p>Do not attach this to YouTube.</p>
    <h2>1. <a href="https://youtu.be/qjIIxuV6DS0">Artist - Last</a></h2>
    <p>Keep this too.</p>
    <iframe src="https://open.spotify.com/embed/track/123"></iframe>
    <p>A Spotify review.</p>
  `);
  assert.deepEqual(playlist.tracks.map((track) => track.description), ['Keep this note.', 'Keep this too.']);
});

test('keeps legacy release descriptions before platform-only link bars', () => {
  const playlist = parse(`
    <h2>97. Artist - First album</h2>
    <h3>(beautiful bedroom pop)</h3>
    <h3><a href="https://open.spotify.com/album/123">Spotify</a> | <a href="https://soundcloud.com/artist/sets/first">SoundCloud</a></h3>
    <h2>96. Artist - Skipped album</h2>
    <h3>(a different genre)</h3>
    <h3><a href="https://artist.bandcamp.com/album/missing">Bandcamp</a></h3>
    <h2>95. Artist - Last album</h2>
    <h3>(spacious &amp; warm)</h3>
    <h4>Must Listen: the incredible opener.</h4>
    <h3><a href="https://soundcloud.com/artist/sets/last">SoundCloud</a></h3>
  `, 'Top 100 releases of 2024');
  assert.deepEqual(playlist.tracks.map((track) => track.description), ['(beautiful bedroom pop)', '(spacious & warm)\n\nMust Listen: the incredible opener.']);
});

test('does not fabricate notes for monthly or link-only lists', () => {
  const playlist = parse(`
    <p>This introduction describes the month, not the songs.</p>
    <h1>3. <a href="https://youtu.be/0VNQ4GemnCY">Artist - First</a></h1>
    <iframe src="https://www.youtube.com/embed/0VNQ4GemnCY"></iframe>
    <div>2. <a href="https://soundcloud.com/artist/second">Artist - Second</a></div>
    <div>1. <a href="https://youtu.be/qjIIxuV6DS0">Artist - Third</a></div>
    <hr><p>Thanks for reading the list.</p>
  `);
  assert.equal(playlist.tracks.length, 3);
  assert.ok(playlist.tracks.every((track) => track.description === undefined));
});

test('shares a review across multiple embeds under the same ranked title', () => {
  const playlist = parse(`
    <h1>1. <a href="https://soundcloud.com/artist/first">Artist - First</a> / <a href="https://soundcloud.com/artist/second">Second</a></h1>
    <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F100"></iframe>
    <iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F200"></iframe>
    <p>A review of both tracks.</p>
  `);
  assert.equal(playlist.tracks.length, 2);
  assert.ok(playlist.tracks.every((track) => track.description === 'A review of both tracks.'));
});

test('handles nested Blogger wrappers without duplicating paragraphs', () => {
  const playlist = parse(`
    <div><div><h1>2. <a href="https://youtu.be/0VNQ4GemnCY">Artist - First</a></h1>
    <div><iframe src="https://www.youtube.com/embed/0VNQ4GemnCY"></iframe></div>
    <div><div><span>A nested <b>review</b>.</span></div></div>
    <h1>1. <a href="https://youtu.be/qjIIxuV6DS0">Artist - Last</a></h1>
    <div>One final note.</div></div></div>
  `);
  assert.deepEqual(playlist.tracks.map((track) => track.description), ['A nested review.', 'One final note.']);
});

test('preserves commentary after a ranked link in the same paragraph', () => {
  const review = 'This spacious arrangement slowly unfolds into something wonderful. '.repeat(6).trim();
  const playlist = parse(`<p>1. <a href="https://youtu.be/0VNQ4GemnCY">Artist - Song</a> ${review}</p>`);
  assert.equal(playlist.tracks[0].description, review);
});

test('rejects malformed commentary in stored catalogs', () => {
  const playlist = parse('<h1>1. <a href="https://youtu.be/0VNQ4GemnCY">Artist - Song</a></h1>');
  playlist.tracks[0].description = ' ';
  assert.throws(() => validateCatalog({
    schemaVersion: 2,
    source: { title: 'billdifferen', url: 'https://billdifferen.blogspot.com/' },
    fetchedAt: '2024-01-03T00:00:00.000Z',
    totalPosts: 1,
    playlists: [playlist],
  }), /Invalid track description/);
});

test('does not assign a post introduction to its untitled opening embed', () => {
  const playlist = parse(`
    <iframe src="https://www.youtube.com/embed/0VNQ4GemnCY"></iframe>
    <p>A long introduction about everything in the year.</p>
    <h1>1. <a href="https://youtu.be/qjIIxuV6DS0">Artist - Song</a></h1>
    <p>Only this is a song review.</p>
  `);
  assert.equal(playlist.tracks[0].description, undefined);
  assert.equal(playlist.tracks[1].description, 'Only this is a song review.');
});

test('does not share unrelated notes between unranked embeds in one section', () => {
  const playlist = parse(`
    <h2>Some club selections</h2>
    <iframe src="https://www.youtube.com/embed/0VNQ4GemnCY"></iframe>
    <p>About the first selection.</p>
    <iframe src="https://www.youtube.com/embed/qjIIxuV6DS0"></iframe>
    <p>About the second selection.</p>
  `);
  assert.deepEqual(playlist.tracks.map((track) => track.description), ['About the first selection.', 'About the second selection.']);
});
