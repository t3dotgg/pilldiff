import type { Page } from '@playwright/test';
import type { CatalogResponse } from '../../shared/types';
import { catalogResponse } from './catalog-fixture';
import { installMockSdks, type MockSdkOptions } from './mock-sdks';

export interface AppHarnessOptions {
  response?: CatalogResponse;
  refreshResponse?: CatalogResponse;
  refreshDelay?: number;
  localStorage?: Record<string, string>;
  sdk?: MockSdkOptions;
}

export async function installAppHarness(
  page: Page,
  options: AppHarnessOptions = {},
): Promise<void> {
  const response = options.response ?? catalogResponse();
  const refreshResponse = options.refreshResponse ?? response;
  await installMockSdks(page, options.sdk);
  await page.route(/\/api\/catalog(?:\/refresh)?(?:\?.*)?$/, async (route) => {
    const isRefresh = route.request().method() === 'POST' || route.request().url().includes('/refresh');
    if (isRefresh && options.refreshDelay) {
      await new Promise((resolve) => setTimeout(resolve, options.refreshDelay));
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(isRefresh ? refreshResponse : response),
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
