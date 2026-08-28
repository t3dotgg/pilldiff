import type { PlaybackOrder, Track } from '../../shared/types';

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'blocked'
  | 'error'
  | 'ended';

export type PlaybackErrorKind = 'item' | 'sdk' | 'environment';

export interface PlaybackSession {
  playlistId: string;
  trackId: string;
  order: PlaybackOrder;
  status: PlaybackStatus;
  intentPlaying: boolean;
  hasStarted: boolean;
  progress: number;
  duration: number;
  volume: number;
  notice?: string;
  errorKind?: PlaybackErrorKind;
}

export type ProviderEvent =
  | { type: 'loading'; generation: number; trackId: string }
  | { type: 'buffering'; generation: number; trackId: string }
  | { type: 'playing'; generation: number; trackId: string }
  | { type: 'paused'; generation: number; trackId: string }
  | { type: 'progress'; generation: number; trackId: string; progress: number; duration: number }
  | { type: 'ended'; generation: number; trackId: string }
  | { type: 'blocked'; generation: number; trackId: string; message: string }
  | {
      type: 'error';
      generation: number;
      trackId: string;
      kind: PlaybackErrorKind;
      message: string;
      code?: number | string;
    };

export interface ProviderLoadOptions {
  autoplay: boolean;
  progress: number;
  volume: number;
  generation: number;
}

export interface ProviderController {
  load(track: Track, options: ProviderLoadOptions): Promise<void>;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  setActive(active: boolean): void;
  retrySdk(): void;
  destroy(): void;
}
