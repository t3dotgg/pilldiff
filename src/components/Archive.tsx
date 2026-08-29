import { useEffect, useRef } from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import { Link } from 'wouter';
import type { Playlist } from '../../shared/types';
import { playlistPath } from '../navigation';

interface ArchiveProps {
  playlists: Playlist[];
  selectedPlaylistId: string;
  search: string;
  open: boolean;
  onSearch: (value: string) => void;
  onSelect: () => void;
  onClose: () => void;
}

export function Archive({
  playlists,
  selectedPlaylistId,
  search,
  open,
  onSearch,
  onSelect,
  onClose,
}: ArchiveProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filtered = playlists.filter((playlist) => {
    if (!normalizedSearch) {
      return true;
    }
    const searchable = [
      playlist.title,
      playlist.shortTitle,
      playlist.category,
      String(playlist.year),
      ...playlist.tracks.flatMap((track) => [track.artist, track.title, track.label]),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return searchable.includes(normalizedSearch);
  });
  const groups = new Map<number, Playlist[]>();
  for (const playlist of filtered) {
    const group = groups.get(playlist.year) ?? [];
    group.push(playlist);
    groups.set(playlist.year, group);
  }
  const yearGroups = [...groups.entries()].sort(([firstYear], [secondYear]) => secondYear - firstYear);
  const clearSearch = () => {
    onSearch('');
    searchRef.current?.focus();
  };

  useEffect(() => {
    const results = resultsRef.current;
    const selected = results?.querySelector<HTMLElement>('.archive-playlist-link[aria-current="page"]');
    if (!results || !selected) {
      return;
    }
    const viewportTop = results.getBoundingClientRect().top + results.clientTop;
    const selectedBounds = selected.getBoundingClientRect();
    if (selectedBounds.top < viewportTop || selectedBounds.bottom > viewportTop + results.clientHeight) {
      const contextOffset = Math.max(0, (results.clientHeight - selectedBounds.height) * 0.3);
      results.scrollTop += selectedBounds.top - viewportTop - contextOffset;
    }
  }, [selectedPlaylistId, open]);

  return (
    <>
      <button
        className={`archive-scrim ${open ? 'is-open' : ''}`}
        aria-label="Close playlist archive"
        onClick={onClose}
      />
      <aside className={`archive ${open ? 'is-open' : ''}`} aria-label="Playlist archive">
        <div className="archive-tools">
          <div className="search-field">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              aria-label="Search playlists and tracks"
              placeholder="Search playlists"
              onChange={(event) => onSearch(event.target.value)}
            />
            {search ? (
              <button className="search-clear" type="button" aria-label="Clear search" onClick={clearSearch}>
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <button className="archive-close" type="button" aria-label="Close playlist archive" onClick={onClose}>
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <span className="sr-only" role="status">{filtered.length} {filtered.length === 1 ? 'playlist' : 'playlists'}</span>
        <div className="archive-results" ref={resultsRef}>
          {filtered.length === 0 ? (
            <div className="empty-filter">
              <p>Nothing in the archive matches that search.</p>
              <button className="text-button" type="button" onClick={clearSearch}>Show all playlists</button>
            </div>
          ) : (
            yearGroups.map(([groupYear, groupPlaylists]) => (
              <section className="archive-year" key={groupYear} aria-label={`${groupYear} playlists`}>
                <h2 className="year-divider">{groupYear}</h2>
                <ul className="archive-list">
                  {groupPlaylists.map((playlist) => {
                    const notesCount = playlist.tracks.filter((track) => track.description).length;
                    return (
                      <li className={`archive-card ${selectedPlaylistId === playlist.id ? 'is-selected' : ''}`} key={playlist.id}>
                        <Link
                          className="archive-playlist-link"
                          href={playlistPath(playlist.id)}
                          data-playlist-id={playlist.id}
                          aria-current={selectedPlaylistId === playlist.id ? 'page' : undefined}
                          onClick={(event) => {
                            if (selectedPlaylistId === playlist.id) {
                              event.preventDefault();
                            }
                            onSelect();
                          }}
                        >
                          <span className="archive-card-title">{playlist.shortTitle || playlist.title}</span>
                          <span className="archive-card-meta">
                            <span>{playlist.category || 'playlist'}</span>
                            <span>{playlist.tracks.length} {playlist.tracks.length === 1 ? 'entry' : 'entries'}</span>
                            {notesCount > 0 ? <span>{notesCount} {notesCount === 1 ? 'note' : 'notes'}</span> : null}
                          </span>
                        </Link>
                        <a className="archive-source-link" href={playlist.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${playlist.title} on billdifferen`}>
                          <ExternalLink size={15} aria-hidden="true" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
