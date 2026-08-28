export function playlistPath(playlistId: string): string {
  return `/playlists/${encodeURIComponent(playlistId)}`;
}
