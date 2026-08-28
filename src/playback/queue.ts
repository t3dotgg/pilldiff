import type { PlaybackOrder, Playlist, Track } from '../../shared/types';
import type { PlaybackSession } from './types';

export function orderedTracks(playlist: Playlist, order: PlaybackOrder): Track[] {
  return order === 'original' ? playlist.tracks : [...playlist.tracks].reverse();
}

export function firstTrack(playlist: Playlist, order: PlaybackOrder): Track | undefined {
  return orderedTracks(playlist, order)[0];
}

export function trackAtOffset(
  playlist: Playlist,
  order: PlaybackOrder,
  currentTrackId: string,
  offset: number,
): Track | undefined {
  const tracks = orderedTracks(playlist, order);
  const currentIndex = tracks.findIndex((track) => track.id === currentTrackId);
  if (currentIndex === -1) {
    return undefined;
  }
  return tracks[currentIndex + offset];
}

export function queuePosition(
  playlist: Playlist,
  order: PlaybackOrder,
  currentTrackId: string,
): { index: number; total: number } {
  const tracks = orderedTracks(playlist, order);
  return {
    index: tracks.findIndex((track) => track.id === currentTrackId),
    total: tracks.length,
  };
}

export function canStep(
  playlist: Playlist,
  order: PlaybackOrder,
  currentTrackId: string,
  offset: number,
): boolean {
  return Boolean(trackAtOffset(playlist, order, currentTrackId, offset));
}

export function createSession(
  playlist: Playlist,
  order: PlaybackOrder,
  trackId: string,
  volume: number,
  intentPlaying: boolean,
  progress = 0,
  hasStarted = intentPlaying,
): PlaybackSession {
  return {
    playlistId: playlist.id,
    trackId,
    order,
    status: intentPlaying ? 'loading' : 'paused',
    intentPlaying,
    hasStarted,
    progress: Math.max(0, progress),
    duration: 0,
    volume: Math.min(1, Math.max(0, volume)),
  };
}

export function changeSessionOrder(
  session: PlaybackSession,
  order: PlaybackOrder,
): PlaybackSession {
  return {
    ...session,
    order,
  };
}

export function nextUnfailedTrack(
  playlist: Playlist,
  order: PlaybackOrder,
  currentTrackId: string,
  failedTrackIds: ReadonlySet<string>,
): Track | undefined {
  const tracks = orderedTracks(playlist, order);
  const currentIndex = tracks.findIndex((track) => track.id === currentTrackId);
  if (currentIndex === -1) {
    return undefined;
  }
  return tracks.slice(currentIndex + 1).find((track) => !failedTrackIds.has(track.id));
}

export function unavailableOutcome(
  playlist: Playlist,
  order: PlaybackOrder,
  currentTrackId: string,
  failedTrackIds: ReadonlySet<string>,
): { nextTrack?: Track; exhausted: boolean } {
  if (failedTrackIds.size >= playlist.tracks.length) {
    return { exhausted: true };
  }
  const nextTrack = nextUnfailedTrack(playlist, order, currentTrackId, failedTrackIds);
  return {
    nextTrack,
    exhausted: !nextTrack,
  };
}
