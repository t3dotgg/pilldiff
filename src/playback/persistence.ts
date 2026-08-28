import type { PlaybackOrder, Playlist } from '../../shared/types';
import { createSession } from './queue';
import type { PlaybackSession } from './types';

const STORAGE_KEY = 'pilldiff.playback.v1';

interface PersistedPlayback {
  version: 1;
  playlistId: string;
  trackId: string;
  order: PlaybackOrder;
  volume: number;
  progress: number;
  hasStarted?: boolean;
}

function isPersistedPlayback(value: unknown): value is PersistedPlayback {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<PersistedPlayback>;
  return (
    candidate.version === 1 &&
    typeof candidate.playlistId === 'string' &&
    typeof candidate.trackId === 'string' &&
    (candidate.order === 'original' || candidate.order === 'reverse') &&
    typeof candidate.volume === 'number' &&
    Number.isFinite(candidate.volume) &&
    typeof candidate.progress === 'number' &&
    Number.isFinite(candidate.progress) &&
    (candidate.hasStarted === undefined || typeof candidate.hasStarted === 'boolean')
  );
}

export function restorePlayback(playlists: Playlist[]): PlaybackSession | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return undefined;
    }
    const persisted = JSON.parse(rawValue) as unknown;
    if (!isPersistedPlayback(persisted)) {
      return undefined;
    }
    const playlist = playlists.find((item) => item.id === persisted.playlistId);
    const track = playlist?.tracks.find((item) => item.id === persisted.trackId);
    if (!playlist || !track) {
      return undefined;
    }
    return createSession(
      playlist,
      persisted.order,
      track.id,
      persisted.volume,
      false,
      persisted.progress,
      persisted.hasStarted === true || persisted.progress > 0,
    );
  } catch {
    return undefined;
  }
}

export function persistPlayback(session: PlaybackSession): void {
  if (typeof window === 'undefined') {
    return;
  }
  const value: PersistedPlayback = {
    version: 1,
    playlistId: session.playlistId,
    trackId: session.trackId,
    order: session.order,
    volume: session.volume,
    progress: session.progress,
    hasStarted: session.hasStarted,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    return;
  }
}
