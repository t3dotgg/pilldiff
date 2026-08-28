import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';

interface PlaylistEntry {
  index: number;
  provider: 'YouTube' | 'SoundCloud';
  title: string;
  sourceUrl: string;
  collection: boolean;
}

interface ProviderObservation {
  provider: PlaylistEntry['provider'];
  title?: string;
  sourceUrl?: string;
  currentTitle?: string;
  currentSourceUrl?: string;
  state?: string;
  states: string[];
  notice?: string;
  reason?: string;
  progress?: string;
  progressAdvanced: boolean;
  playerVisible: boolean;
}

interface HandoffObservation {
  direction: string;
  attempted: boolean;
  advanced: boolean;
  fromTitle?: string;
  expectedTitle?: string;
  expectedSourceUrl?: string;
  toTitle?: string;
  toSourceUrl?: string;
  state?: string;
  states?: string[];
  notice?: string;
  reason?: string;
  progress?: string;
  progressAdvanced: boolean;
  result: 'playing' | 'blocked' | 'error' | 'not-advanced' | 'unavailable' | 'timeout';
}

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.PLAYWRIGHT_CHANNEL;
const pageErrors: string[] = [];

async function visibleText(page: Page, selector: string): Promise<string | undefined> {
  const locator = page.locator(selector).filter({ visible: true }).first();
  if (!(await locator.count())) {
    return undefined;
  }
  const text = (await locator.textContent())?.trim();
  return text || undefined;
}

async function observePlayback(
  page: Page,
  entry: PlaylistEntry,
  timeout = 8_000,
): Promise<ProviderObservation> {
  const states = new Set<string>();
  let currentTitle: string | undefined;
  let currentSourceUrl: string | undefined;
  let state: string | undefined;
  let notice: string | undefined;
  let progress: string | undefined;
  let firstPosition: number | undefined;
  let progressAdvanced = false;
  const observationDeadline = Date.now() + timeout;

  while (Date.now() < observationDeadline) {
    currentTitle = await visibleText(page, '.transport-track strong');
    currentSourceUrl = await page.locator('.track-list li.is-current .track-source')
      .evaluateAll((links) => links[0]?.getAttribute('href') ?? undefined);
    const matchesEntry = currentSourceUrl === entry.sourceUrl;
    state = await visibleText(page, '.player-state');
    if (state && matchesEntry) {
      states.add(state);
    }
    notice = await visibleText(page, '.playback-notice p');
    const times = await page.getByLabel('Playback controls').locator('time').allTextContents();
    progress = times.length === 2 ? `${times[0]} / ${times[1]}` : undefined;
    if (matchesEntry && state === 'playing') {
      const position = Number(await page.getByRole('slider', { name: 'Seek', exact: true }).inputValue());
      if (Number.isFinite(position)) {
        firstPosition ??= position;
        progressAdvanced = position > 0 && position > firstPosition;
      }
    }
    if (state === 'blocked' || state === 'error' || (matchesEntry && progressAdvanced)) {
      break;
    }
    await page.waitForTimeout(500);
  }

  const frameSelector = entry.provider === 'YouTube' ? '.youtube-frame' : '.soundcloud-frame';
  return {
    provider: entry.provider,
    title: entry.title,
    sourceUrl: entry.sourceUrl,
    currentTitle,
    currentSourceUrl,
    state,
    states: [...states],
    notice,
    progress,
    progressAdvanced,
    playerVisible: await page.locator(frameSelector).isVisible(),
  };
}

async function observeProvider(
  page: Page,
  provider: PlaylistEntry['provider'],
  entry?: PlaylistEntry,
): Promise<ProviderObservation> {
  if (!entry) {
    return {
      provider,
      states: [],
      progressAdvanced: false,
      playerVisible: false,
      reason: `No ${provider} entry is available in the selected playlist.`,
    };
  }
  await page.locator('.track-list > li').nth(entry.index).getByRole('button').click();
  return observePlayback(page, entry);
}

function findHandoffSource(
  entries: PlaylistEntry[],
  provider: PlaylistEntry['provider'],
  nextProvider: PlaylistEntry['provider'],
): PlaylistEntry | undefined {
  return entries.find((entry, index) => (
    entry.provider === provider &&
    !entry.collection &&
    entries[index + 1]?.provider === nextProvider &&
    !entries[index + 1]?.collection
  )) ?? entries.find((entry) => entry.provider === provider && !entry.collection);
}

async function observeNaturalHandoff(
  page: Page,
  source: ProviderObservation,
  nextProvider: PlaylistEntry['provider'],
  nextEntry?: PlaylistEntry,
): Promise<HandoffObservation> {
  const observation: HandoffObservation = {
    direction: `${source.provider}→${nextProvider}`,
    attempted: false,
    advanced: false,
    fromTitle: source.title,
    expectedTitle: nextEntry?.title,
    expectedSourceUrl: nextEntry?.sourceUrl,
    progressAdvanced: false,
    result: 'unavailable',
  };
  if (process.env.PILLDIFF_LIVE_HANDOFF === '0') {
    return { ...observation, reason: 'Natural handoff diagnostics are disabled.' };
  }
  if (!nextEntry || nextEntry.provider !== nextProvider || nextEntry.collection) {
    return { ...observation, reason: 'No adjacent individual entry has the requested provider.' };
  }
  if (!source.progressAdvanced || source.state !== 'playing' || source.currentSourceUrl !== source.sourceUrl) {
    return { ...observation, reason: 'The source did not reach PLAY with advancing progress.', notice: source.notice };
  }
  const seek = page.getByRole('slider', { name: 'Seek' });
  const maximum = Number(await seek.getAttribute('max'));
  if (!Number.isFinite(maximum) || maximum <= 3 || await seek.isDisabled()) {
    return { ...observation, reason: 'The source did not expose a seekable duration.' };
  }
  const nearEnd = Math.floor(Math.max(0, maximum - 2) * 10) / 10;
  await seek.fill(String(nearEnd));
  const destination = await observePlayback(page, nextEntry, 15_000);
  const advanced = destination.currentSourceUrl === nextEntry.sourceUrl;

  return {
    ...observation,
    attempted: true,
    advanced,
    toTitle: destination.currentTitle,
    toSourceUrl: destination.currentSourceUrl,
    state: destination.state,
    states: destination.states,
    notice: destination.notice,
    progress: destination.progress,
    progressAdvanced: destination.progressAdvanced,
    result: !advanced
      ? 'not-advanced'
      : destination.state === 'blocked' || destination.state === 'error'
        ? destination.state
        : destination.state === 'playing' && destination.progressAdvanced && destination.playerVisible
          ? 'playing'
          : 'timeout',
  };
}

await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel,
});

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  context.setDefaultTimeout(5_000);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('group', { name: 'Playback order' })
    .getByRole('button', { name: 'Blog order', exact: true }).click();
  const entries: PlaylistEntry[] = await page.locator('.track-list > li').evaluateAll((rows) => (
    rows.map((row, index) => ({
      index,
      provider: row.querySelector('.provider-badge.youtube') ? 'YouTube' as const : 'SoundCloud' as const,
      title: row.querySelector('.track-copy strong')?.textContent?.trim() ?? '',
      sourceUrl: row.querySelector('.track-source')?.getAttribute('href') ?? '',
      collection: Boolean(row.querySelector('.collection-badge')),
    }))
  ));
  const youtubeEntry = findHandoffSource(entries, 'YouTube', 'SoundCloud');
  const soundcloudEntry = findHandoffSource(entries, 'SoundCloud', 'YouTube');

  const youtube = await observeProvider(page, 'YouTube', youtubeEntry);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/live-smoke-desktop.png',
    fullPage: false,
    animations: 'disabled',
  });

  const youtubeToSoundCloud = await observeNaturalHandoff(
    page,
    youtube,
    'SoundCloud',
    youtubeEntry ? entries[youtubeEntry.index + 1] : undefined,
  );
  const soundcloud = await observeProvider(page, 'SoundCloud', soundcloudEntry);
  const soundCloudToYouTube = await observeNaturalHandoff(
    page,
    soundcloud,
    'YouTube',
    soundcloudEntry ? entries[soundcloudEntry.index + 1] : undefined,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const archiveToggle = page.getByRole('button', { name: 'Open playlist archive', exact: true });
  if (await archiveToggle.getAttribute('aria-expanded') === 'true') {
    await page.getByRole('complementary', { name: 'Playlist archive', exact: true })
      .getByRole('button', { name: 'Close playlist archive', exact: true }).click();
  }
  await page.locator('.archive.is-open').waitFor({ state: 'detached' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/live-smoke-mobile-390.png',
    fullPage: false,
    animations: 'disabled',
  });
  await archiveToggle.click();
  await page.locator('.archive.is-open').waitFor({ state: 'visible' });
  await page.screenshot({
    path: 'test-results/live-smoke-mobile-390-archive-open.png',
    fullPage: false,
    animations: 'disabled',
  });

  const playerStates = await page.locator('.player-state').allTextContents();
  process.stdout.write(`${JSON.stringify({
    baseUrl,
    channel: channel ?? 'bundled chromium',
    pageErrors,
    visiblePlayerStates: playerStates.map((state) => state.trim()).filter(Boolean),
    providers: [youtube, soundcloud],
    naturalHandoffs: { youtubeToSoundCloud, soundCloudToYouTube },
    screenshots: [
      'test-results/live-smoke-desktop.png',
      'test-results/live-smoke-mobile-390.png',
      'test-results/live-smoke-mobile-390-archive-open.png',
    ],
  }, null, 2)}\n`);
  await context.close();
} finally {
  await browser.close();
}
