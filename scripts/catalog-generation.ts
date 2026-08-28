import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Catalog } from '../shared/types.js';
import { validateCatalog } from '../server/importer.js';

export async function writeCatalogAtomically(path: string, catalog: Catalog): Promise<void> {
  validateCatalog(catalog);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function generateCatalog(
  outputPath: string,
  loadCatalog: () => Promise<Catalog>,
): Promise<Catalog> {
  const catalog = await loadCatalog();
  await writeCatalogAtomically(outputPath, catalog);
  return catalog;
}
