import { LoaderCircle, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import type { Playlist, Track } from '../../shared/types';
import type { PlaybackSession } from '../playback/types';

interface TransportProps {
  session?: PlaybackSession;
  playlist?: Playlist;
  track?: Track;
  queueIndex: number;
  queueTotal: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (volume: number) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export function Transport({
  session,
  playlist,
  track,
  queueIndex,
  queueTotal,
  canPrevious,
  canNext,
  onPrevious,
  onTogglePlay,
  onNext,
  onSeek,
  onVolume,
}: TransportProps) {
  const isPending = session?.status === 'loading' && session.intentPlaying;
  const isPlaying = session?.status === 'playing' || session?.status === 'buffering' || isPending;
  const progress = session?.progress ?? 0;
  const duration = session?.duration ?? 0;
  return (
    <footer className="transport" aria-label="Playback controls">
      <div className="transport-track">
        <span className={`transport-provider ${track?.provider ?? 'idle'}`} />
        <div>
          <strong>{track?.title || track?.label || 'Nothing cued'}</strong>
          <span>{track?.artist || playlist?.shortTitle || 'Choose a playlist from the archive'}</span>
        </div>
      </div>
      <div className="transport-center">
        <div className="transport-buttons">
          <button type="button" aria-label="Previous track" onClick={onPrevious} disabled={!canPrevious}>
            <SkipBack size={19} fill="currentColor" />
          </button>
          <button
            className="transport-play"
            type="button"
            aria-label={isPending ? 'Cancel pending playback' : isPlaying ? 'Pause playback' : 'Play playback'}
            onClick={onTogglePlay}
            disabled={!track}
          >
            {isPending ? <LoaderCircle className="spin" size={19} /> : isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
          </button>
          <button type="button" aria-label="Next track" onClick={onNext} disabled={!canNext}>
            <SkipForward size={19} fill="currentColor" />
          </button>
        </div>
        <div className="seek-row">
          <time>{formatTime(progress)}</time>
          <input
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={Math.min(progress, duration || 1)}
            disabled={!duration}
            aria-label="Seek"
            style={{ '--range-progress': `${duration ? (progress / duration) * 100 : 0}%` } as React.CSSProperties}
            onChange={(event) => onSeek(Number(event.target.value))}
          />
          <time>{formatTime(duration)}</time>
        </div>
      </div>
      <div className="transport-context">
        <div>
          <strong>{playlist?.shortTitle || 'No playlist'}</strong>
          <span>
            {queueIndex >= 0 ? `${queueIndex + 1} of ${queueTotal}` : '—'} · {session?.order === 'reverse' ? 'reverse' : 'blog order'}
          </span>
        </div>
        <label className="volume-control">
          <Volume2 size={17} />
          <span className="sr-only">Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={session?.volume ?? 0.78}
            aria-label="Volume"
            onChange={(event) => onVolume(Number(event.target.value))}
          />
        </label>
      </div>
    </footer>
  );
}
