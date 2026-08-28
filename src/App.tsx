import { AudioLines, ExternalLink, LoaderCircle, Menu, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Catalog, PlaybackOrder, Playlist } from '../shared/types';
import { Archive } from './components/Archive';
import { EmbedStage } from './components/EmbedStage';
import { PlaylistView } from './components/PlaylistView';
import { Transport } from './components/Transport';
import { usePlayback } from './playback/usePlayback';

interface CatalogState {
  catalog?: Catalog;
  loading: boolean;
  checking: boolean;
  error?: string;
  warning?: string;
}

async function requestCatalog(checkForUpdates = false, signal?: AbortSignal): Promise<Catalog> {
  const url = checkForUpdates ? `/catalog.json?check=${Date.now()}` : '/catalog.json';
  const response = await fetch(url, {
    method: 'GET',
    signal,
    cache: checkForUpdates ? 'no-store' : 'default',
    headers: {
      Accept: 'application/json',
      ...(checkForUpdates ? { 'Cache-Control': 'no-cache' } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`The archive returned ${response.status}.`);
  }
  const catalog = (await response.json()) as Catalog;
  if (catalog?.schemaVersion !== 2 || !Array.isArray(catalog.playlists)) {
    throw new Error('The archive returned an unexpected response.');
  }
  return catalog;
}

function formatSnapshotDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return 'date unknown';
  }
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function AppMark() {
  return (
    <span className="app-mark" aria-hidden="true">
      <AudioLines size={25} strokeWidth={1.5} />
    </span>
  );
}

function MusicWorkspace({
  catalog,
  warning,
  checking,
  onCheckForUpdates,
}: {
  catalog: Catalog;
  warning?: string;
  checking: boolean;
  onCheckForUpdates: () => void;
}) {
  const playlists = catalog.playlists;
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
        (target.closest('input, select, textarea, button, a, summary') || target.isContentEditable)
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
          <span className="brand-name">billdifferen</span>
          <span className="brand-tagline">the unofficial playlist player</span>
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
          <span className="snapshot-date">snapshot {formatSnapshotDate(catalog.fetchedAt)}</span>
          <a href={catalog.source.url} target="_blank" rel="noreferrer">
            original blog <ExternalLink size={14} />
          </a>
          <button
            type="button"
            onClick={onCheckForUpdates}
            disabled={checking}
            aria-label="Check for playlist updates"
          >
            <RefreshCw size={15} className={checking ? 'spin' : ''} />
            <span>{checking ? 'Checking' : 'Check for updates'}</span>
          </button>
        </div>
      </header>
      {warning ? (
        <div className="catalog-warning" role="status">
          {warning}
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
              <button className="primary-button" type="button" onClick={onCheckForUpdates} disabled={checking}>
                <RefreshCw size={17} className={checking ? 'spin' : ''} /> Check for updates
              </button>
            </div>
          )}
          <EmbedStage
            session={playback.session}
            track={playback.currentTrack}
            sourceUrl={playback.playingPlaylist?.sourceUrl}
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
    checking: false,
  });

  const loadInitial = useMemo(
    () => (signal?: AbortSignal) => {
      setCatalogState((current) => ({ ...current, loading: true, error: undefined }));
      void requestCatalog(false, signal)
        .then((catalog) => setCatalogState({ catalog, loading: false, checking: false }))
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return;
          }
          setCatalogState({
            loading: false,
            checking: false,
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

  const checkForUpdates = () => {
    if (catalogState.checking) {
      return;
    }
    setCatalogState((current) => ({ ...current, checking: true, warning: undefined }));
    void requestCatalog(true)
      .then((catalog) => setCatalogState({ catalog, loading: false, checking: false }))
      .catch((error) => {
        setCatalogState((current) => ({
          ...current,
          checking: false,
          warning: current.catalog
            ? `Couldn’t check the deployed snapshot. ${error instanceof Error ? error.message : 'The check failed.'} The current archive is still available.`
            : undefined,
          error: current.catalog
            ? undefined
            : error instanceof Error
              ? error.message
              : 'The playlist archive could not be checked.',
        }));
      });
  };

  if (catalogState.loading) {
    return (
      <div className="loading-screen" role="status">
        <AppMark />
        <LoaderCircle className="spin" size={28} />
        <p>Opening the billdifferen archive…</p>
      </div>
    );
  }

  if (!catalogState.catalog || catalogState.error) {
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
      catalog={catalogState.catalog}
      warning={catalogState.warning}
      checking={catalogState.checking}
      onCheckForUpdates={checkForUpdates}
    />
  );
}
