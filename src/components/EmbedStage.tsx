import { AlertCircle, AudioLines, ExternalLink, LoaderCircle, Play, RotateCcw, SkipForward } from 'lucide-react';
import type { RefObject } from 'react';
import type { Track } from '../../shared/types';
import type { PlaybackSession } from '../playback/types';
import { TrackNotes } from './TrackNotes';

interface EmbedStageProps {
  session?: PlaybackSession;
  track?: Track;
  sourceUrl?: string;
  youtubeHostRef: RefObject<HTMLDivElement | null>;
  soundCloudHostRef: RefObject<HTMLDivElement | null>;
  onContinue: () => void;
  onRetry: () => void;
  onSkip: () => void;
}

export function EmbedStage({
  session,
  track,
  sourceUrl,
  youtubeHostRef,
  soundCloudHostRef,
  onContinue,
  onRetry,
  onSkip,
}: EmbedStageProps) {
  const showNotice = session?.notice && ['blocked', 'error', 'ended'].includes(session.status);
  return (
    <aside className="embed-stage" aria-label="Now playing source">
      <div className="embed-heading">
        <span>Source player</span>
        {session?.status === 'loading' || session?.status === 'buffering' ? (
          <span className="player-state"><LoaderCircle className="spin" size={14} /> {session.status}</span>
        ) : (
          <span className={`player-state state-${session?.status ?? 'idle'}`}>{session?.status ?? 'waiting'}</span>
        )}
      </div>
      {showNotice ? (
        <div className={`playback-notice notice-${session?.status}`} role="status">
          <AlertCircle size={18} />
          <div>
            <p>{session?.notice}</p>
            <div className="notice-actions">
              {session?.status === 'blocked' ? (
                <button type="button" onClick={onContinue}><Play size={14} fill="currentColor" /> Continue playback</button>
              ) : null}
              {session?.status === 'error' ? (
                <button type="button" onClick={onRetry}><RotateCcw size={14} /> Retry current</button>
              ) : null}
              {session?.status === 'error' && session.errorKind === 'item' ? (
                <button type="button" onClick={onSkip}><SkipForward size={14} /> Skip entry</button>
              ) : null}
              {track ? (
                <a href={track.sourceUrl} target="_blank" rel="noreferrer">Open source <ExternalLink size={13} /></a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="embed-shell">
        <div
          className={`provider-frame youtube-frame ${track?.provider === 'youtube' ? 'is-active' : ''}`}
          ref={youtubeHostRef}
          aria-hidden={track?.provider !== 'youtube'}
        />
        <div
          className={`provider-frame soundcloud-frame ${track?.provider === 'soundcloud' ? 'is-active' : ''}`}
          ref={soundCloudHostRef}
          aria-hidden={track?.provider !== 'soundcloud'}
        />
        {!track ? (
          <div className="embed-empty">
            <AudioLines size={32} strokeWidth={1} />
            <p>Pick a playlist. Press play.</p>
          </div>
        ) : null}
      </div>
      {track ? (
        <div className="embed-caption">
          <span className={`provider-line ${track.provider}`} />
          <div>
            <strong>{track.title || track.label}</strong>
            {track.artist ? <span>{track.artist}</span> : null}
          </div>
        </div>
      ) : null}
      {track?.description ? (
        <div className="now-playing-notes">
          <TrackNotes key={track.id} track={track} sourceUrl={sourceUrl} initiallyOpen />
        </div>
      ) : null}
    </aside>
  );
}
