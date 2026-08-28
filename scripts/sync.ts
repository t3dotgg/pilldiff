import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCatalogAtomically } from '../server/catalog-store.js';
import { importCatalog } from '../server/importer.js';

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seedPath = resolve(rootDirectory, 'data/catalog.json');
const catalog = await importCatalog();
await writeCatalogAtomically(seedPath, catalog);
console.log(`Synced ${catalog.playlists.length} playable posts from ${catalog.totalPosts} total posts.`);
