import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Catalog } from '../shared/types.js';
import { importCatalog, validateCatalog } from '../server/importer.js';
import { generateCatalog } from './catalog-generation.js';

export type CatalogSource = 'live' | 'snapshot';

export interface PrepareCatalogOptions {
  outputPath?: string;
  seedPath?: string;
  importer?: () => Promise<Catalog>;
}

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readSnapshot(path: string): Promise<Catalog> {
  const catalog = JSON.parse(await readFile(path, 'utf8')) as Catalog;
  validateCatalog(catalog);
  return catalog;
}

export async function prepareCatalog(
  source: CatalogSource,
  options: PrepareCatalogOptions = {},
): Promise<Catalog> {
  const outputPath = options.outputPath ?? resolve(rootDirectory, 'public/catalog.json');
  const seedPath = options.seedPath ?? resolve(rootDirectory, 'data/catalog.json');
  const loadCatalog = source === 'live'
    ? options.importer ?? (() => importCatalog())
    : () => readSnapshot(seedPath);
  return generateCatalog(outputPath, loadCatalog);
}

async function run(): Promise<void> {
  const sourceArgument = process.argv[2];
  const source = sourceArgument === '--live'
    ? 'live'
    : sourceArgument === '--snapshot'
      ? 'snapshot'
      : undefined;
  if (!source) {
    throw new Error('Usage: tsx scripts/prepare-catalog.ts --live|--snapshot');
  }
  const catalog = await prepareCatalog(source);
  const sourceLabel = source === 'live' ? 'Blogger' : 'the committed snapshot';
  console.log(`Prepared ${catalog.playlists.length} playable posts from ${sourceLabel}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
