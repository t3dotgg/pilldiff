import assert from 'node:assert/strict';
import test from 'node:test';
import type { Playlist, Track } from '../shared/types';
import {
  canStep,
  changeSessionOrder,
  createSession,
  firstTrack,
  orderedTracks,
  queuePosition,
  snapshotPlaylist,
  trackAtOffset,
  unavailableOutcome,
} from '../src/playback/queue';

function makeTrack(id: string, rank: number): Track {
  return {
    id,
    provider: rank % 2 === 0 ? 'youtube' : 'soundcloud',
    title: `Track ${rank}`,
    artist: `Artist ${rank}`,
    label: `Artist ${rank} — Track ${rank}`,
    sourceUrl: `https://example.com/${id}`,
    playbackUrl: `https://example.com/play/${id}`,
    rank,
    position: rank - 1,
    kind: 'track',
  };
}

const playlist: Playlist = {
  id: 'playlist-2026',
  title: 'Countdown 2026',
  shortTitle: '2026',
  category: 'Countdown',
  publishedAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  year: 2026,
  sourceUrl: 'https://example.com/playlist',
  tracks: [makeTrack('rank-50', 50), makeTrack('rank-49', 49), makeTrack('rank-1', 1)],
  skipped: { bandcamp: 0, other: 0 },
};

test('active playlist snapshots freeze independent metadata and track copies', () => {
  const snapshot = snapshotPlaylist(playlist);

  assert.deepEqual(snapshot, playlist);
  assert.notEqual(snapshot, playlist);
  assert.notEqual(snapshot.tracks, playlist.tracks);
  assert.notEqual(snapshot.tracks[0], playlist.tracks[0]);
  assert.notEqual(snapshot.skipped, playlist.skipped);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.tracks), true);
  assert.equal(snapshot.tracks.every((track) => Object.isFrozen(track)), true);
  assert.equal(Object.isFrozen(snapshot.skipped), true);
  assert.equal(Object.isFrozen(playlist), false);
  assert.equal(Object.isFrozen(playlist.tracks[0]), false);
});

test('catalog changes do not alter a captured queue or its traversal', () => {
  const source: Playlist = {
    ...playlist,
    tracks: playlist.tracks.map((track) => ({ ...track })),
    skipped: { ...playlist.skipped },
  };
  const catalog = [source];
  const snapshot = snapshotPlaylist(source);
  const session = createSession(snapshot, 'original', 'rank-50', 0.7, true, 42);

  source.title = 'Updated countdown';
  source.tracks[0].title = 'Replacement track';
  source.tracks[0].provider = 'soundcloud';
  source.tracks[0].playbackUrl = 'https://example.com/replacement';
  source.tracks.splice(1, 1);
  source.skipped.bandcamp = 3;

  const freshSnapshot = snapshotPlaylist(source);
  catalog.splice(0);

  assert.deepEqual(snapshot, playlist);
  assert.equal(catalog.length, 0);
  assert.equal(snapshot.tracks[0].provider, 'youtube');
  assert.equal(trackAtOffset(snapshot, session.order, session.trackId, 1)?.id, 'rank-49');
  assert.equal(canStep(snapshot, session.order, session.trackId, -1), false);
  assert.deepEqual(queuePosition(snapshot, session.order, session.trackId), { index: 0, total: 3 });
  const reversed = changeSessionOrder(session, 'reverse');
  assert.equal(reversed.trackId, 'rank-50');
  assert.equal(reversed.progress, 42);
  assert.equal(trackAtOffset(snapshot, reversed.order, reversed.trackId, -1)?.id, 'rank-49');
  assert.equal(canStep(snapshot, reversed.order, reversed.trackId, 1), false);
  assert.equal(freshSnapshot.title, 'Updated countdown');
  assert.equal(freshSnapshot.tracks[0].title, 'Replacement track');
  assert.equal(freshSnapshot.tracks.length, 2);
});

test('orders entries by blog order or reversed blog order', () => {
  assert.deepEqual(
    orderedTracks(playlist, 'original').map((track) => track.id),
    ['rank-50', 'rank-49', 'rank-1'],
  );
  assert.deepEqual(
    orderedTracks(playlist, 'reverse').map((track) => track.id),
    ['rank-1', 'rank-49', 'rank-50'],
  );
  assert.equal(firstTrack(playlist, 'original')?.id, 'rank-50');
  assert.equal(firstTrack(playlist, 'reverse')?.id, 'rank-1');
});

test('steps within queue bounds without wrapping', () => {
  assert.equal(trackAtOffset(playlist, 'original', 'rank-50', 1)?.id, 'rank-49');
  assert.equal(trackAtOffset(playlist, 'original', 'rank-50', -1), undefined);
  assert.equal(trackAtOffset(playlist, 'reverse', 'rank-1', 1)?.id, 'rank-49');
  assert.equal(trackAtOffset(playlist, 'reverse', 'rank-50', 1), undefined);
  assert.equal(canStep(playlist, 'reverse', 'rank-1', -1), false);
  assert.equal(canStep(playlist, 'reverse', 'rank-1', 1), true);
});

test('changing order preserves current identity and playback position', () => {
  const session = createSession(playlist, 'original', 'rank-49', 0.7, true, 42);
  const reversed = changeSessionOrder(session, 'reverse');
  assert.equal(reversed.trackId, 'rank-49');
  assert.equal(reversed.progress, 42);
  assert.equal(reversed.order, 'reverse');
  assert.deepEqual(queuePosition(playlist, reversed.order, reversed.trackId), {
    index: 1,
    total: 3,
  });
});

test('default paused cue remains unstarted while a listening session starts', () => {
  const cue = createSession(playlist, 'original', 'rank-50', 0.78, false);
  const listening = createSession(playlist, 'reverse', 'rank-1', 0.78, true);
  assert.equal(cue.hasStarted, false);
  assert.equal(cue.intentPlaying, false);
  assert.equal(listening.hasStarted, true);
  assert.equal(listening.intentPlaying, true);
});

test('unavailable entries advance once and stop at the queue boundary', () => {
  const firstFailures = new Set(['rank-50']);
  const firstOutcome = unavailableOutcome(
    playlist,
    'original',
    'rank-50',
    firstFailures,
  );
  assert.equal(firstOutcome.nextTrack?.id, 'rank-49');
  assert.equal(firstOutcome.exhausted, false);

  const laterFailures = new Set(['rank-50', 'rank-49']);
  const laterOutcome = unavailableOutcome(
    playlist,
    'original',
    'rank-49',
    laterFailures,
  );
  assert.equal(laterOutcome.nextTrack?.id, 'rank-1');

  const boundaryFailures = new Set(['rank-1']);
  const boundaryOutcome = unavailableOutcome(
    playlist,
    'original',
    'rank-1',
    boundaryFailures,
  );
  assert.equal(boundaryOutcome.nextTrack, undefined);
  assert.equal(boundaryOutcome.exhausted, true);
});

test('all failed entries produce a bounded exhausted outcome', () => {
  const failedTrackIds = new Set(playlist.tracks.map((track) => track.id));
  const outcome = unavailableOutcome(
    playlist,
    'reverse',
    'rank-49',
    failedTrackIds,
  );
  assert.equal(outcome.nextTrack, undefined);
  assert.equal(outcome.exhausted, true);
});
