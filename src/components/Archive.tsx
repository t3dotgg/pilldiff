import { ExternalLink, Search, X } from 'lucide-react';
import type { Playlist } from '../../shared/types';

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
  onSelect: (playlistId: string) => void;
  onClose: () => void;
  onClear: () => void;
}

function providerCounts(playlist: Playlist): { youtube: number; soundcloud: number } {
  return playlist.tracks.reduce(
    (counts, track) => ({ ...counts, [track.provider]: counts[track.provider] + 1 }),
    { youtube: 0, soundcloud: 0 },
  );
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
  let renderedYear: number | undefined;

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
          <label className="search-field">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search playlists and tracks</span>
            <input
              type="search"
              value={search}
              placeholder="Search playlists or tracks"
              onChange={(event) => onSearch(event.target.value)}
            />
          </label>
          <div className="filter-row">
            <label>
              <span className="sr-only">Filter by year</span>
              <select value={year} onChange={(event) => onYear(event.target.value)} aria-label="Filter by year">
                <option value="">All years</option>
                {years.map((availableYear) => (
                  <option key={availableYear} value={availableYear}>{availableYear}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by category</span>
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
        </div>
        <div className="archive-results" aria-live="polite">
          <div className="archive-count">
            <span>{filtered.length} {filtered.length === 1 ? 'playlist' : 'playlists'}</span>
            {hasFilters ? <button type="button" onClick={onClear}>Clear</button> : null}
          </div>
          {filtered.length === 0 ? (
            <div className="empty-filter">
              <p>Nothing in the archive matches that search.</p>
              <button className="text-button" type="button" onClick={onClear}>Reset filters</button>
            </div>
          ) : (
            filtered.map((playlist) => {
              const showYear = renderedYear !== playlist.year;
              renderedYear = playlist.year;
              const counts = providerCounts(playlist);
              return (
                <div key={playlist.id}>
                  {showYear ? <div className="year-divider">{playlist.year}</div> : null}
                  <div className={`archive-card ${selectedPlaylistId === playlist.id ? 'is-selected' : ''}`}>
                    <button type="button" onClick={() => onSelect(playlist.id)}>
                      <span className="archive-card-title">{playlist.shortTitle || playlist.title}</span>
                      <span className="archive-card-meta">
                        {playlist.category || 'playlist'} · {playlist.tracks.length} entries
                      </span>
                      <span className="provider-tally" aria-label={`${counts.youtube} YouTube and ${counts.soundcloud} SoundCloud entries`}>
                        {counts.youtube > 0 ? <span className="youtube-dot">YT {counts.youtube}</span> : null}
                        {counts.soundcloud > 0 ? <span className="soundcloud-dot">SC {counts.soundcloud}</span> : null}
                      </span>
                    </button>
                    <a href={playlist.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${playlist.title} on billdifferen`}>
                      <ExternalLink size={15} />
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
