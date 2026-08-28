import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { playlistPath } from '../src/navigation.js';

test('builds playlist paths without rounding or normalizing string IDs', () => {
  assert.equal(playlistPath('4187003885016673397'), '/playlists/4187003885016673397');
  assert.equal(playlistPath('001234567890123456789'), '/playlists/001234567890123456789');
  assert.equal(playlistPath('july-2026'), '/playlists/july-2026');
});

test('encodes playlist IDs as a single path segment', () => {
  assert.equal(playlistPath('post /?#%'), '/playlists/post%20%2F%3F%23%25');
});

test('scopes the deployment SPA rewrite to playlist paths', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.rewrites, [{ source: '/playlists/:path*', destination: '/index.html' }]);
});
