# Sidebar layout studies

Three standalone comparisons for a roomier archive sidebar. Every option uses the same 39 playlists from `data/catalog.json`, removes provider tallies from the sidebar, and keeps each playlist title fully readable.

## Options

- `01-reading-list.html` is the closest evolution of the current archive: a 390px chronological list with title, series, entry count, optional note count, and compact filters.
- `02-year-index.html` turns each year into a native accordion. It opens 2025 and 2024 initially, keeps 2026 collapsed, and opens every matching year during search.
- `03-series-library.html` uses a category rail plus a wider playlist column. It starts on Year-end and keeps year as a secondary facet.

## Preview

Open any HTML file directly with `file://`, or use the existing Vite server:

```text
http://127.0.0.1:5173/mocks/sidebar/01-reading-list.html
http://127.0.0.1:5173/mocks/sidebar/02-year-index.html
http://127.0.0.1:5173/mocks/sidebar/03-series-library.html
```

The right pane is shared comparison context. Selecting any playlist updates its real title, metadata, original artwork, original-post link, and six-track sample. Audio is intentionally disconnected.

## Stable selectors

- Playlist entries: `[data-playlist-id="4187003885016673397"]`
- Reading-list controls: `#reading-search`, `#reading-year`, `#reading-category`
- Year accordions: `[data-year="2025"]`
- Year-index search: `#year-search`
- Series controls: `[data-category="Features"]`, `#series-search`, `#series-year`
- Empty-state reset: `[data-action="clear-filters"]`
- Main preview: `#preview-title`, `#preview-artwork`, `#preview-track-sample`
