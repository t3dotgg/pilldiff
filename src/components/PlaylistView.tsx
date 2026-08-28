import { ExternalLink, ListMusic, LoaderCircle, Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PlaybackOrder, Playlist, Track } from '../../shared/types';
import { orderedTracks } from '../playback/queue';
import type { PlaybackSession } from '../playback/types';

interface PlaylistViewProps {
  playlist: Playlist;
  order: PlaybackOrder;
  session?: PlaybackSession;
  currentTrack?: Track;
  onOrder: (order: PlaybackOrder) => void;
  onPlayPlaylist: () => void;
  onPlayTrack: (trackId: string) => void;
  onTogglePlay: () => void;
}

function Artwork({ playlist }: { playlist: Playlist }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [playlist.artworkUrl]);
  if (!playlist.artworkUrl || failed) {
    return (
      <div className="artwork artwork-fallback" aria-label="Playlist artwork unavailable">
        <span className="fallback-disc"><span /></span>
        <strong>{playlist.year}</strong>
        <small>{playlist.category || 'billdifferen playlist'}</small>
      </div>
    );
  }
  return (
    <div className="artwork">
      <img src={playlist.artworkUrl} alt="" onError={() => setFailed(true)} />
    </div>
  );
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function displayTrack(track: Track): { primary: string; secondary?: string } {
  const primary = track.title || track.label || 'Untitled entry';
  const secondary = track.artist && track.artist !== primary ? track.artist : undefined;
  return { primary, secondary };
}

export function PlaylistView({
  playlist,
  order,
  session,
  currentTrack,
  onOrder,
  onPlayPlaylist,
  onPlayTrack,
  onTogglePlay,
}: PlaylistViewProps) {
  const youtubeCount = playlist.tracks.filter((track) => track.provider === 'youtube').length;
  const soundCloudCount = playlist.tracks.length - youtubeCount;
  const isActivePlaylist = session?.playlistId === playlist.id;
  const isActiveListeningSession = isActivePlaylist && session.hasStarted;
  const isPending = isActiveListeningSession && session.status === 'loading' && session.intentPlaying;
  const isActivelyPlaying =
    isActiveListeningSession &&
    session.intentPlaying &&
    (session.status === 'playing' || session.status === 'buffering' || isPending);
  const visibleTracks = orderedTracks(playlist, order);

  return (
    <section className="playlist-view" aria-labelledby="playlist-title">
      <div className="playlist-hero">
        <Artwork playlist={playlist} />
        <div className="playlist-intro">
          <div className="eyebrow">{playlist.category || 'playlist'} · {playlist.year}</div>
          <h1 id="playlist-title">{playlist.title}</h1>
          <div className="playlist-meta">
            <span>posted {dateLabel(playlist.publishedAt)}</span>
            <span>{playlist.tracks.length} supported entries</span>
            <span className="youtube-text">{youtubeCount} YouTube</span>
            <span className="soundcloud-text">{soundCloudCount} SoundCloud</span>
          </div>
          {playlist.skipped.bandcamp > 0 ? (
            <p className="skip-note">{playlist.skipped.bandcamp} Bandcamp {playlist.skipped.bandcamp === 1 ? 'entry' : 'entries'} shown on the blog are skipped for now.</p>
          ) : null}
          <div className="playlist-actions">
            <button
              className="primary-button"
              type="button"
              onClick={isActiveListeningSession ? onTogglePlay : onPlayPlaylist}
              aria-label={isPending ? 'Cancel pending playlist' : isActivelyPlaying ? 'Pause selected playlist' : 'Play selected playlist'}
            >
              {isPending ? <LoaderCircle className="spin" size={18} /> : isActivelyPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              {isPending ? 'Cancel' : isActivelyPlaying ? 'Pause' : isActiveListeningSession ? 'Resume' : 'Play'}
            </button>
            <div className="order-switch" role="group" aria-label="Playback order">
              <button
                type="button"
                aria-pressed={order === 'original'}
                onClick={() => onOrder('original')}
              >
                Blog order
              </button>
              <button
                type="button"
                aria-pressed={order === 'reverse'}
                onClick={() => onOrder('reverse')}
              >
                Reverse
              </button>
            </div>
            <a className="source-button" href={playlist.sourceUrl} target="_blank" rel="noreferrer">
              Original post <ExternalLink size={15} />
            </a>
          </div>
        </div>
      </div>
      <div className="track-heading">
        <div><ListMusic size={18} /> Tracklist</div>
        <span>Blog ranking stays visible in either playback order.</span>
      </div>
      <ol className="track-list">
        {visibleTracks.map((track) => {
          const labels = displayTrack(track);
          const isCurrent = isActivePlaylist && currentTrack?.id === track.id;
          return (
            <li key={track.id} className={isCurrent ? 'is-current' : ''}>
              <button
                className="track-main"
                type="button"
                onClick={() => onPlayTrack(track.id)}
                aria-label={`Play ${track.label || labels.primary}`}
              >
                <span className="track-rank">{track.rank ?? track.position + 1}</span>
                <span className="track-copy">
                  <strong>{labels.primary}</strong>
                  {labels.secondary ? <span>{labels.secondary}</span> : null}
                </span>
                {track.kind === 'playlist' ? <span className="collection-badge">collection</span> : null}
                <span className={`provider-badge ${track.provider}`}>
                  {track.provider === 'youtube' ? 'YouTube' : 'SoundCloud'}
                </span>
                <span className="row-play" aria-hidden="true">
                  {isCurrent && session?.status === 'playing' ? <span className="level-bars"><i /><i /><i /></span> : <Play size={15} fill="currentColor" />}
                </span>
              </button>
              <a
                className="track-source"
                href={track.sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open source for ${track.label || labels.primary}`}
                title={track.label || labels.primary}
              >
                <ExternalLink size={14} />
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
