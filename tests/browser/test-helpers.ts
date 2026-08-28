import { expect, type Page } from '@playwright/test';
import type { MockCall, MockInstanceSnapshot, MockProvider } from './mock-sdks';
import { sdkSnapshot } from './mock-sdks';

export async function openCatalog(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'July 2026 — Four Bright Corners' })).toBeVisible();
  await expect.poll(async () => (await sdkSnapshot(page)).instances.length).toBeGreaterThan(0);
}

export async function expectCurrentTrack(page: Page, title: string): Promise<void> {
  await expect(
    page.getByLabel('Playback controls').getByText(title, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Now playing source').getByText(title, { exact: true }),
  ).toBeVisible();
}

export async function latestInstance(
  page: Page,
  provider: MockProvider,
): Promise<MockInstanceSnapshot | undefined> {
  const snapshot = await sdkSnapshot(page);
  return snapshot.instances.filter(
    (instance) => instance.provider === provider && !instance.destroyed,
  ).at(-1);
}

export async function providerCalls(
  page: Page,
  provider: MockProvider,
  methods?: string[],
): Promise<MockCall[]> {
  const snapshot = await sdkSnapshot(page);
  return snapshot.calls.filter(
    (call) => call.provider === provider && (!methods || methods.includes(call.method)),
  );
}

export async function clearSdkCalls(page: Page): Promise<void> {
  await page.evaluate(() => window.__pilldiffSdkDriver.clearCalls());
}

export async function waitForProviderPlaying(
  page: Page,
  provider: MockProvider,
): Promise<void> {
  await expect.poll(async () => {
    const instance = await latestInstance(page, provider);
    return provider === 'youtube'
      ? instance?.playing === true && instance.playerState === 1
      : instance?.playing === true;
  }).toBe(true);
  await expect(page.getByLabel('Now playing source').getByText('playing', { exact: true })).toBeVisible();
}

export async function finishProvider(
  page: Page,
  provider: MockProvider,
  repeats = 1,
  instanceId?: number,
): Promise<void> {
  await page.evaluate(
    (action) => window.__pilldiffSdkDriver.finish(
      action.provider,
      action.repeats,
      action.instanceId,
    ),
    { provider, repeats, instanceId },
  );
}

export async function failProvider(
  page: Page,
  provider: MockProvider,
  code?: number | string,
): Promise<void> {
  await page.evaluate(
    (action) => window.__pilldiffSdkDriver.fail(action.provider, action.code),
    { provider, code },
  );
}

export async function setProviderProgress(
  page: Page,
  provider: MockProvider,
  seconds: number,
  duration = 240,
): Promise<void> {
  await page.evaluate(
    (action) => window.__pilldiffSdkDriver.setProgress(
      action.provider,
      action.seconds,
      action.duration,
    ),
    { provider, seconds, duration },
  );
}

export async function selectPlaylist(page: Page, title: string): Promise<void> {
  const archiveButton = page.getByRole('button', { name: 'Open playlist archive' });
  if (await archiveButton.isVisible()) {
    await archiveButton.click();
  }
  await page.getByRole('complementary', { name: 'Playlist archive' })
    .getByRole('button', { name: new RegExp(`^${title}`) })
    .click();
}
