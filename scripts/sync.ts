import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCatalog } from '../server/importer.js';
import { writeCatalogAtomically } from './catalog-generation.js';

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seedPath = resolve(rootDirectory, 'data/catalog.json');
const catalog = await importCatalog();
await writeCatalogAtomically(seedPath, catalog);
console.log(`Synced ${catalog.playlists.length} playable posts from ${catalog.totalPosts} total posts.`);
