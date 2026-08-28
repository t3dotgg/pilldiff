import type { Catalog, CatalogResponse, Playlist, Track } from '../../shared/types';

function track(overrides: Partial<Track> & Pick<Track, 'id' | 'provider' | 'title' | 'position'>): Track {
  return {
    artist: `${overrides.title} Artist`,
    label: overrides.title,
    sourceUrl: `https://example.test/source/${overrides.id}`,
    playbackUrl: `https://example.test/play/${overrides.id}`,
    kind: 'track',
    ...overrides,
  };
}

export const summerPlaylist: Playlist = {
  id: 'july-2026',
  title: 'July 2026 — Four Bright Corners',
  shortTitle: 'July 2026',
  category: 'Monthly Mix',
  publishedAt: '2026-07-31T12:00:00.000Z',
  updatedAt: '2026-07-31T12:00:00.000Z',
  year: 2026,
  sourceUrl: 'https://billdifferen.blogspot.com/2026/07/four-bright-corners.html',
  artworkUrl: 'https://example.test/art/july.jpg',
  skipped: { bandcamp: 1, other: 0 },
  tracks: [
    track({
      id: 'youtube-sunrise',
      provider: 'youtube',
      title: 'Sunrise Relay',
      playbackUrl: 'https://www.youtube.com/watch?v=yt-sunrise',
      sourceUrl: 'https://www.youtube.com/watch?v=yt-sunrise',
      videoId: 'yt-sunrise',
      rank: 4,
      position: 0,
    }),
    track({
      id: 'soundcloud-river',
      provider: 'soundcloud',
      title: 'River Signal',
      playbackUrl: 'https://soundcloud.com/pilldiff/river-signal',
      sourceUrl: 'https://soundcloud.com/pilldiff/river-signal',
      rank: 3,
      position: 1,
    }),
    track({
      id: 'youtube-night',
      provider: 'youtube',
      title: 'Night Geometry',
      playbackUrl: 'https://www.youtube.com/watch?v=yt-night',
      sourceUrl: 'https://www.youtube.com/watch?v=yt-night',
      videoId: 'yt-night',
      rank: 2,
      position: 2,
    }),
    track({
      id: 'soundcloud-static',
      provider: 'soundcloud',
      title: 'Static Orchard',
      playbackUrl: 'https://soundcloud.com/pilldiff/static-orchard',
      sourceUrl: 'https://soundcloud.com/pilldiff/static-orchard',
      rank: 1,
      position: 3,
    }),
  ],
};

export const collectionPlaylist: Playlist = {
  id: 'collections-2025',
  title: 'Collections 2025 — Long Players',
  shortTitle: 'Collections 2025',
  category: 'Year-end list',
  publishedAt: '2025-12-20T12:00:00.000Z',
  updatedAt: '2025-12-20T12:00:00.000Z',
  year: 2025,
  sourceUrl: 'https://billdifferen.blogspot.com/2025/12/long-players.html',
  skipped: { bandcamp: 0, other: 1 },
  tracks: [
    track({
      id: 'youtube-collection',
      provider: 'youtube',
      title: 'Video Constellation',
      playbackUrl: 'https://www.youtube.com/playlist?list=PL-pilldiff',
      sourceUrl: 'https://www.youtube.com/playlist?list=PL-pilldiff',
      playlistId: 'PL-pilldiff',
      kind: 'playlist',
      rank: 2,
      position: 0,
    }),
    track({
      id: 'soundcloud-collection',
      provider: 'soundcloud',
      title: 'Cloud Sequence',
      playbackUrl: 'https://soundcloud.com/pilldiff/sets/cloud-sequence',
      sourceUrl: 'https://soundcloud.com/pilldiff/sets/cloud-sequence',
      kind: 'playlist',
      rank: 1,
      position: 1,
    }),
  ],
};

export const browserCatalog: Catalog = {
  schemaVersion: 2,
  source: {
    title: 'Difference',
    url: 'https://billdifferen.blogspot.com/',
  },
  fetchedAt: '2026-08-28T06:00:00.000Z',
  totalPosts: 40,
  playlists: [summerPlaylist, collectionPlaylist],
};

export function catalogResponse(overrides: Partial<CatalogResponse> = {}): CatalogResponse {
  return {
    catalog: browserCatalog,
    stale: false,
    ...overrides,
  };
}
