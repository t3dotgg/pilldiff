export type Provider = 'youtube' | 'soundcloud';

export type PlaybackOrder = 'original' | 'reverse';

export interface Track {
  id: string;
  provider: Provider;
  title: string;
  artist: string;
  label: string;
  sourceUrl: string;
  playbackUrl: string;
  videoId?: string;
  playlistId?: string;
  rank?: number;
  position: number;
  kind: 'track' | 'playlist';
  startSeconds?: number;
  description?: string;
}

export interface Playlist {
  id: string;
  title: string;
  shortTitle: string;
  category: string;
  publishedAt: string;
  updatedAt: string;
  year: number;
  sourceUrl: string;
  artworkUrl?: string;
  tracks: Track[];
  skipped: { bandcamp: number; other: number };
}

export interface Catalog {
  schemaVersion: 2;
  source: { title: string; url: string };
  fetchedAt: string;
  totalPosts: number;
  playlists: Playlist[];
}

export interface CatalogResponse {
  catalog: Catalog;
  stale: boolean;
  warning?: string;
}
