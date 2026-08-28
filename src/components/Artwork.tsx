import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import type { Playlist } from '../../shared/types';

function ArtworkImage({ playlist }: { playlist: Playlist }) {
  const [status, setStatus] = useState(playlist.artworkUrl ? 'loading' : 'missing');
  const loading = status === 'loading';

  return (
    <div className="artwork" data-state={status} aria-busy={loading}>
      {status !== 'ready' ? (
        <div className="artwork-placeholder" role="img" aria-label={`${loading ? 'Loading artwork' : 'Artwork unavailable'} for ${playlist.shortTitle}`}>
          <span className="artwork-placeholder-wordmark" aria-hidden="true">billdifferen</span>
          <div className="artwork-placeholder-caption">
            <strong>{playlist.shortTitle}</strong>
            <span>{loading ? <><LoaderCircle className="spin" size={13} /> Loading original artwork</> : 'No artwork available'}</span>
          </div>
        </div>
      ) : null}
      {playlist.artworkUrl && status !== 'missing' ? (
        <img
          src={playlist.artworkUrl}
          alt={`Artwork from ${playlist.shortTitle}`}
          decoding="async"
          className={status === 'ready' ? 'is-ready' : ''}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('missing')}
        />
      ) : null}
    </div>
  );
}

export function Artwork({ playlist }: { playlist: Playlist }) {
  return <ArtworkImage key={`${playlist.id}:${playlist.artworkUrl ?? ''}`} playlist={playlist} />;
}
