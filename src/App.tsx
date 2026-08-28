import { ExternalLink, Library, Menu, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogResponse, PlaybackOrder, Playlist } from '../shared/types';
import { Archive } from './components/Archive';
import { EmbedStage } from './components/EmbedStage';
import { PlaylistView } from './components/PlaylistView';
import { Transport } from './components/Transport';
import { usePlayback } from './playback/usePlayback';

interface CatalogState {
  response?: CatalogResponse;
  loading: boolean;
  refreshing: boolean;
  error?: string;
}

async function requestCatalog(method: 'GET' | 'POST', signal?: AbortSignal): Promise<CatalogResponse> {
  const response = await fetch(method === 'GET' ? '/api/catalog' : '/api/catalog/refresh', {
    method,
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`The archive returned ${response.status}.`);
  }
  const value = (await response.json()) as CatalogResponse;
  if (!value?.catalog || !Array.isArray(value.catalog.playlists)) {
    throw new Error('The archive returned an unexpected response.');
  }
  return value;
}

function AppMark() {
  return (
    <span className="app-mark" aria-hidden="true">
      <span className="app-mark-slot" />
      <span className="app-mark-hole" />
    </span>
  );
}

function MusicWorkspace({
  response,
  refreshing,
  onRefresh,
}: {
  response: CatalogResponse;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const playlists = response.catalog.playlists;
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(playlists[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const [category, setCategory] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [browseOrders, setBrowseOrders] = useState<Record<string, PlaybackOrder>>({});
  const youtubeHostRef = useRef<HTMLDivElement>(null);
  const soundCloudHostRef = useRef<HTMLDivElement>(null);
  const playback = usePlayback(playlists, youtubeHostRef, soundCloudHostRef);

  useEffect(() => {
    if (!playlists.some((playlist) => playlist.id === selectedPlaylistId)) {
      setSelectedPlaylistId(playlists[0]?.id ?? '');
    }
  }, [playlists, selectedPlaylistId]);

  const selectedPlaylist =
    playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? playlists[0];
  const selectedOrder =
    playback.session && playback.session.playlistId === selectedPlaylist?.id
      ? playback.session.order
      : browseOrders[selectedPlaylist?.id ?? ''] ?? 'original';

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('input, select, textarea, button, a') || target.isContentEditable)
      ) {
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        playback.togglePlay();
      } else if (event.code === 'ArrowRight' && playback.canNext) {
        event.preventDefault();
        playback.next();
      } else if (event.code === 'ArrowLeft' && playback.canPrevious) {
        event.preventDefault();
        playback.previous();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [playback]);

  const handleOrder = (order: PlaybackOrder) => {
    if (!selectedPlaylist) {
      return;
    }
    setBrowseOrders((current) => ({ ...current, [selectedPlaylist.id]: order }));
    if (playback.session?.playlistId === selectedPlaylist.id) {
      playback.setOrder(order);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setYear('');
    setCategory('');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <AppMark />
          <span className="brand-name">pilldiff</span>
          <span className="brand-tagline">the billdifferen playlist player</span>
        </div>
        <div className="topbar-actions">
          <button
            className="archive-toggle"
            type="button"
            aria-label="Open playlist archive"
            aria-expanded={archiveOpen}
            onClick={() => setArchiveOpen(true)}
          >
            <Menu size={18} /> Archive
          </button>
          <a href={response.catalog.source.url} target="_blank" rel="noreferrer">
            original blog <ExternalLink size={14} />
          </a>
          <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh playlist archive">
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
            <span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </header>
      {response.stale || response.warning ? (
        <div className="catalog-warning" role="status">
          Showing the saved archive. {response.warning || 'A fresh blog check is not available right now.'}
        </div>
      ) : null}
      <div className="workspace">
        <Archive
          playlists={playlists}
          selectedPlaylistId={selectedPlaylist?.id ?? ''}
          search={search}
          year={year}
          category={category}
          open={archiveOpen}
          onSearch={setSearch}
          onYear={setYear}
          onCategory={setCategory}
          onSelect={(playlistId) => {
            setSelectedPlaylistId(playlistId);
            setArchiveOpen(false);
            window.scrollTo({ top: 0, behavior: 'instant' });
          }}
          onClose={() => setArchiveOpen(false)}
          onClear={clearFilters}
        />
        <main className="listening-room">
          {selectedPlaylist ? (
            <PlaylistView
              playlist={selectedPlaylist}
              order={selectedOrder}
              session={playback.session}
              currentTrack={playback.currentTrack}
              onOrder={handleOrder}
              onPlayPlaylist={() => playback.startPlaylist(selectedPlaylist, selectedOrder)}
              onPlayTrack={(trackId) => playback.startPlaylist(selectedPlaylist, selectedOrder, trackId)}
              onTogglePlay={playback.togglePlay}
            />
          ) : (
            <div className="empty-catalog">
              <AppMark />
              <h1>The archive is quiet.</h1>
              <p>No posts with supported YouTube or SoundCloud sources were found.</p>
              <button className="primary-button" type="button" onClick={onRefresh} disabled={refreshing}>
                <RefreshCw size={17} className={refreshing ? 'spin' : ''} /> Refresh archive
              </button>
            </div>
          )}
          <EmbedStage
            session={playback.session}
            track={playback.currentTrack}
            youtubeHostRef={youtubeHostRef}
            soundCloudHostRef={soundCloudHostRef}
            onContinue={playback.togglePlay}
            onRetry={playback.retryCurrent}
            onSkip={playback.skipCurrent}
          />
        </main>
      </div>
      <Transport
        session={playback.session}
        playlist={playback.playingPlaylist}
        track={playback.currentTrack}
        queueIndex={playback.queueIndex}
        queueTotal={playback.queueTotal}
        canPrevious={playback.canPrevious}
        canNext={playback.canNext}
        onPrevious={playback.previous}
        onTogglePlay={playback.togglePlay}
        onNext={playback.next}
        onSeek={playback.seek}
        onVolume={playback.setVolume}
      />
    </div>
  );
}

export default function App() {
  const [catalogState, setCatalogState] = useState<CatalogState>({
    loading: true,
    refreshing: false,
  });

  const loadInitial = useMemo(
    () => (signal?: AbortSignal) => {
      setCatalogState((current) => ({ ...current, loading: true, error: undefined }));
      void requestCatalog('GET', signal)
        .then((response) => setCatalogState({ response, loading: false, refreshing: false }))
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return;
          }
          setCatalogState({
            loading: false,
            refreshing: false,
            error: error instanceof Error ? error.message : 'The playlist archive could not be loaded.',
          });
        });
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadInitial(controller.signal);
    return () => controller.abort();
  }, [loadInitial]);

  const refresh = () => {
    if (catalogState.refreshing) {
      return;
    }
    setCatalogState((current) => ({ ...current, refreshing: true }));
    void requestCatalog('POST')
      .then((response) => setCatalogState({ response, loading: false, refreshing: false }))
      .catch((error) => {
        setCatalogState((current) => ({
          ...current,
          refreshing: false,
          response: current.response
            ? {
                ...current.response,
                stale: true,
                warning: error instanceof Error ? error.message : 'The blog refresh failed.',
              }
            : current.response,
          error: current.response
            ? undefined
            : error instanceof Error
              ? error.message
              : 'The playlist archive could not be refreshed.',
        }));
      });
  };

  if (catalogState.loading) {
    return (
      <div className="loading-screen" role="status">
        <AppMark />
        <div className="loading-record"><span /></div>
        <p>Indexing the billdifferen archive…</p>
      </div>
    );
  }

  if (!catalogState.response || catalogState.error) {
    return (
      <div className="error-screen" role="alert">
        <AppMark />
        <span className="error-kicker">archive unavailable</span>
        <h1>Couldn’t reach the playlists.</h1>
        <p>{catalogState.error || 'The catalog is unavailable.'}</p>
        <button className="primary-button" type="button" onClick={() => loadInitial()}>
          Try again
        </button>
        <a href="https://billdifferen.blogspot.com/" target="_blank" rel="noreferrer">
          Visit billdifferen <ExternalLink size={14} />
        </a>
      </div>
    );
  }

  return (
    <MusicWorkspace
      response={catalogState.response}
      refreshing={catalogState.refreshing}
      onRefresh={refresh}
    />
  );
}
