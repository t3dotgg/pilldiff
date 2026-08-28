import type { Page } from '@playwright/test';
import type { Catalog } from '../../shared/types';
import { browserCatalog } from './catalog-fixture';
import { installMockSdks, type MockSdkOptions } from './mock-sdks';

export interface AppHarnessOptions {
  catalog?: Catalog;
  updatedCatalog?: Catalog;
  updateDelay?: number;
  updateStatus?: number;
  localStorage?: Record<string, string>;
  sdk?: MockSdkOptions;
}

export async function installAppHarness(
  page: Page,
  options: AppHarnessOptions = {},
): Promise<void> {
  const catalog = options.catalog ?? browserCatalog;
  const updatedCatalog = options.updatedCatalog ?? catalog;
  await installMockSdks(page, options.sdk);
  await page.route(/\/catalog\.json(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const isUpdateCheck = new URL(request.url()).searchParams.has('check');
    if (request.method() !== 'GET') {
      await route.fulfill({ status: 405, body: 'Method not allowed' });
      return;
    }
    if (isUpdateCheck && options.updateDelay) {
      await new Promise((resolve) => setTimeout(resolve, options.updateDelay));
    }
    if (isUpdateCheck && options.updateStatus) {
      await route.fulfill({
        status: options.updateStatus,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Update check failed' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(isUpdateCheck ? updatedCatalog : catalog),
    });
  });
  if (options.localStorage) {
    await page.addInitScript((storageEntries) => {
      for (const [storageKey, storageValue] of Object.entries(storageEntries)) {
        window.localStorage.setItem(storageKey, storageValue);
      }
    }, options.localStorage);
  }
}
