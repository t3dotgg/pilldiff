import { useEffect, useRef } from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import { Link } from 'wouter';
import type { Playlist } from '../../shared/types';
import { playlistPath } from '../navigation';

interface ArchiveProps {
  playlists: Playlist[];
  selectedPlaylistId: string;
  search: string;
  year: string;
  category: string;
  open: boolean;
  onSearch: (value: string) => void;
  onYear: (value: string) => void;
  onCategory: (value: string) => void;
  onSelect: () => void;
  onClose: () => void;
  onClear: () => void;
}

export function Archive({
  playlists,
  selectedPlaylistId,
  search,
  year,
  category,
  open,
  onSearch,
  onYear,
  onCategory,
  onSelect,
  onClose,
  onClear,
}: ArchiveProps) {
  const resultsRef = useRef<HTMLDivElement>(null);
  const years = [...new Set(playlists.map((playlist) => playlist.year))].sort(
    (firstYear, secondYear) => secondYear - firstYear,
  );
  const categories = [...new Set(playlists.map((playlist) => playlist.category).filter(Boolean))].sort();
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filtered = playlists.filter((playlist) => {
    if (year && String(playlist.year) !== year) {
      return false;
    }
    if (category && playlist.category !== category) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }
    const searchable = [
      playlist.title,
      playlist.shortTitle,
      playlist.category,
      ...playlist.tracks.flatMap((track) => [track.artist, track.title, track.label]),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return searchable.includes(normalizedSearch);
  });
  const hasFilters = Boolean(search || year || category);
  const groups = new Map<number, Playlist[]>();
  for (const playlist of filtered) {
    const group = groups.get(playlist.year) ?? [];
    group.push(playlist);
    groups.set(playlist.year, group);
  }
  const yearGroups = [...groups.entries()].sort(([firstYear], [secondYear]) => secondYear - firstYear);

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
        <div className="archive-mobile-head">
          <span>playlist archive</span>
          <button className="icon-button" type="button" aria-label="Close playlist archive" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <div className="archive-tools">
          <h2 className="archive-label">The archive</h2>
          <label className="archive-field">
            <span className="archive-field-label">Search</span>
            <span className="search-field">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={search}
                aria-label="Search playlists and tracks"
                placeholder="Search playlists or tracks"
                onChange={(event) => onSearch(event.target.value)}
              />
            </span>
          </label>
          <div className="filter-row">
            <label className="archive-field">
              <span className="archive-field-label">Year</span>
              <select value={year} onChange={(event) => onYear(event.target.value)} aria-label="Filter by year">
                <option value="">All years</option>
                {years.map((availableYear) => (
                  <option key={availableYear} value={availableYear}>{availableYear}</option>
                ))}
              </select>
            </label>
            <label className="archive-field">
              <span className="archive-field-label">Series</span>
              <select
                value={category}
                onChange={(event) => onCategory(event.target.value)}
                aria-label="Filter by category"
              >
                <option value="">All series</option>
                {categories.map((availableCategory) => (
                  <option key={availableCategory} value={availableCategory}>{availableCategory}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="archive-count">
            <span role="status">{filtered.length} {filtered.length === 1 ? 'playlist' : 'playlists'}</span>
            {hasFilters ? <button type="button" onClick={onClear}>Clear</button> : null}
          </div>
        </div>
        <div className="archive-results" ref={resultsRef}>
          {filtered.length === 0 ? (
            <div className="empty-filter">
              <p>Nothing in the archive matches that search.</p>
              <button className="text-button" type="button" onClick={onClear}>Reset filters</button>
            </div>
          ) : (
            yearGroups.map(([groupYear, groupPlaylists]) => (
              <section className="archive-year" key={groupYear} aria-label={`${groupYear} playlists`}>
                <h3 className="year-divider">{groupYear}</h3>
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
