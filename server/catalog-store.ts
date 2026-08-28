import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Catalog, CatalogResponse } from '../shared/types.js';
import { importCatalog, validateCatalog } from './importer.js';

const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 60 * 1000;

export interface CatalogStoreOptions {
  seedPath: string;
  cachePath: string;
  importer?: () => Promise<Catalog>;
  now?: () => Date;
  staleMs?: number;
  cooldownMs?: number;
}

async function readCatalog(path: string): Promise<Catalog | undefined> {
  try {
    const catalog = JSON.parse(await readFile(path, 'utf8')) as Catalog;
    validateCatalog(catalog);
    return catalog;
  } catch {
    return undefined;
  }
}

export async function writeCatalogAtomically(path: string, catalog: Catalog): Promise<void> {
  validateCatalog(catalog);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

export class CatalogStore {
  private readonly options: Required<Pick<CatalogStoreOptions, 'seedPath' | 'cachePath' | 'importer' | 'now' | 'staleMs' | 'cooldownMs'>>;
  private catalog?: Catalog;
  private refreshPromise?: Promise<CatalogResponse>;
  private lastRefreshStartedAt = Number.NEGATIVE_INFINITY;

  constructor(options: CatalogStoreOptions) {
    this.options = {
      seedPath: options.seedPath,
      cachePath: options.cachePath,
      importer: options.importer ?? (() => importCatalog()),
      now: options.now ?? (() => new Date()),
      staleMs: options.staleMs ?? DEFAULT_STALE_MS,
      cooldownMs: options.cooldownMs ?? DEFAULT_COOLDOWN_MS,
    };
  }

  private response(catalog: Catalog, warning?: string): CatalogResponse {
    const age = this.options.now().getTime() - new Date(catalog.fetchedAt).getTime();
    return {
      catalog,
      stale: warning !== undefined || !Number.isFinite(age) || age > this.options.staleMs,
      warning,
    };
  }

  async get(): Promise<CatalogResponse> {
    if (!this.catalog) {
      const [cache, seed] = await Promise.all([
        readCatalog(this.options.cachePath),
        readCatalog(this.options.seedPath),
      ]);
      const available = [cache, seed].filter((catalog): catalog is Catalog => catalog !== undefined);
      this.catalog = available.sort((left, right) => Date.parse(right.fetchedAt) - Date.parse(left.fetchedAt))[0];
      if (!this.catalog) throw new Error('No valid catalog snapshot is available');
    }
    return this.response(this.catalog);
  }

  async refresh(): Promise<CatalogResponse> {
    if (this.refreshPromise) return this.refreshPromise;
    const refreshPromise = this.performRefresh().finally(() => {
      if (this.refreshPromise === refreshPromise) this.refreshPromise = undefined;
    });
    this.refreshPromise = refreshPromise;
    return refreshPromise;
  }

  private async performRefresh(): Promise<CatalogResponse> {
    let current: CatalogResponse | undefined;
    try {
      current = await this.get();
    } catch {
      current = undefined;
    }
    const now = this.options.now().getTime();
    if (current && now - this.lastRefreshStartedAt < this.options.cooldownMs) {
      return this.response(current.catalog, 'Refresh is cooling down; the current catalog is still available.');
    }
    this.lastRefreshStartedAt = now;
    try {
      const freshCatalog = await this.options.importer();
      validateCatalog(freshCatalog);
      await writeCatalogAtomically(this.options.cachePath, freshCatalog);
      this.catalog = freshCatalog;
      return this.response(freshCatalog);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown refresh failure';
      if (current) {
        return this.response(current.catalog, `Refresh failed; using the last known catalog. ${message}`);
      }
      throw new Error(`Refresh failed and no valid catalog is available. ${message}`);
    }
  }
}
