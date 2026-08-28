import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Catalog, Playlist, Provider, Track } from '../shared/types.js';
import { attachTrackDescriptions, type TrackSelection } from './commentary.js';

export const BLOG_URL = 'https://billdifferen.blogspot.com/';
export const FEED_URL = 'https://billdifferen.blogspot.com/feeds/posts/default';
export const SOURCE_TITLE = 'billdifferen';

const FEED_PAGE_SIZE = 25;
const REQUEST_TIMEOUT_MS = 15_000;
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

interface BloggerValue<T> {
  $t: T;
}

interface BloggerLink {
  rel: string;
  href: string;
}

export interface BloggerEntry {
  id: BloggerValue<string>;
  title: BloggerValue<string>;
  published: BloggerValue<string>;
  updated: BloggerValue<string>;
  content: BloggerValue<string>;
  link?: BloggerLink[];
  media$thumbnail?: { url?: string };
}

interface BloggerFeedPage {
  feed?: {
    entry?: BloggerEntry[];
    openSearch$totalResults?: BloggerValue<string>;
  };
}

interface ParsedMedia {
  provider: Provider;
  sourceUrl: string;
  playbackUrl: string;
  fingerprint: string;
  kind: 'track' | 'playlist';
  videoId?: string;
  playlistId?: string;
  startSeconds?: number;
}

interface MediaEvent {
  nodes: AnyNode[];
  type: 'anchor' | 'iframe';
  order: number;
  blockOrder: number;
  joinsNextAnchor: boolean;
  media: ParsedMedia;
  label: string;
  rank?: number;
  attribution?: { label: string; sourceUrl: string };
}

interface HeadingContext {
  order: number;
  text: string;
  rank?: number;
}

export interface ImportOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  pageSize?: number;
  timeoutMs?: number;
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripRank(value: string): string {
  return normalizeText(value)
    .replace(/^#?\s*\d{1,3}\s*[.):;-]\s*/, '')
    .replace(/^must\s+listen\s*:\s*/i, '')
    .trim();
}

function extractRank(value: string): number | undefined {
  const match = normalizeText(value).match(/^#?\s*(\d{1,3})\s*[.):;-]/);
  return match ? Number(match[1]) : undefined;
}

function extractRanks(value: string): number[] {
  return [...normalizeText(value).matchAll(/(?:^|\s)#?(\d{1,3})\s*[.):;-]\s*/g)].map((match) => Number(match[1]));
}

function parseTime(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.toLowerCase().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function safeUrl(rawUrl: string): URL | undefined {
  try {
    const trimmedUrl = rawUrl.trim();
    const knownBareHost = /^(?:www\.)?(?:youtube\.com|youtu\.be|soundcloud\.com|w\.soundcloud\.com)\//i.test(trimmedUrl);
    const normalizedUrl = trimmedUrl.startsWith('//') ? `https:${trimmedUrl}` : knownBareHost ? `https://${trimmedUrl}` : trimmedUrl;
    return new URL(normalizedUrl);
  } catch {
    return undefined;
  }
}

function decodeRepeatedly(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function parseYouTube(rawUrl: string): ParsedMedia | undefined {
  const url = safeUrl(rawUrl);
  if (!url) return undefined;
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const youtubeHost = hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'music.youtube.com';
  const embedHost = youtubeHost || hostname === 'youtube-nocookie.com';
  let videoId: string | undefined;
  let playlistId: string | undefined;

  if (hostname === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0];
  } else if (embedHost) {
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/watch') videoId = url.searchParams.get('v') ?? undefined;
    if (['embed', 'shorts', 'v'].includes(pathParts[0] ?? '')) videoId = pathParts[1];
    if (url.pathname === '/playlist') playlistId = url.searchParams.get('list') ?? undefined;
    if (pathParts[0] === 'embed' && pathParts[1] === 'videoseries') {
      videoId = undefined;
      playlistId = url.searchParams.get('list') ?? undefined;
    }
  }

  if (videoId && !/^[A-Za-z0-9_-]{11}$/.test(videoId)) videoId = undefined;
  if (playlistId && !/^[A-Za-z0-9_-]{10,}$/.test(playlistId)) playlistId = undefined;
  if (!videoId && !playlistId) return undefined;

  if (videoId) {
    const startSeconds = parseTime(url.searchParams.get('start') ?? url.searchParams.get('t'));
    const playbackUrl = new URL(`https://www.youtube.com/embed/${videoId}`);
    if (startSeconds) playbackUrl.searchParams.set('start', String(startSeconds));
    return {
      provider: 'youtube',
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      playbackUrl: playbackUrl.toString(),
      fingerprint: `video:${videoId}`,
      kind: 'track',
      videoId,
      startSeconds,
    };
  }

  return {
    provider: 'youtube',
    sourceUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
    playbackUrl: `https://www.youtube.com/embed/videoseries?list=${playlistId}`,
    fingerprint: `playlist:${playlistId}`,
    kind: 'playlist',
    playlistId,
  };
}

function parseSoundCloudTarget(rawTarget: string): ParsedMedia | undefined {
  const decodedTarget = decodeRepeatedly(rawTarget).replace(/^soundcloud:tracks:/i, 'https://api.soundcloud.com/tracks/');
  const urnMatch = decodedTarget.match(/(?:\/tracks\/)?soundcloud:tracks:(\d+)/i);
  const query = decodedTarget.includes('?') ? decodedTarget.slice(decodedTarget.indexOf('?')) : '';
  const normalizedTarget = urnMatch ? `https://api.soundcloud.com/tracks/${urnMatch[1]}${query}` : decodedTarget;
  const url = safeUrl(normalizedTarget);
  if (!url) return undefined;
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');

  if (hostname === 'api.soundcloud.com') {
    const trackMatch = url.pathname.match(/^\/tracks\/(\d+)\/?$/);
    const playlistMatch = url.pathname.match(/^\/(?:playlists|sets)\/(\d+)\/?$/);
    const numericId = trackMatch?.[1] ?? playlistMatch?.[1];
    if (!numericId) return undefined;
    const kind = playlistMatch ? 'playlist' : 'track';
    const canonicalUrl = new URL(`https://api.soundcloud.com/${kind === 'playlist' ? 'playlists' : 'tracks'}/${numericId}`);
    const secretToken = url.searchParams.get('secret_token');
    if (secretToken) canonicalUrl.searchParams.set('secret_token', secretToken);
    const canonical = canonicalUrl.toString();
    return {
      provider: 'soundcloud',
      sourceUrl: canonical,
      playbackUrl: canonical,
      fingerprint: `${kind}:${numericId}`,
      kind,
    };
  }

  if (hostname !== 'soundcloud.com' && hostname !== 'm.soundcloud.com') return undefined;
  const pathParts = url.pathname.split('/').filter(Boolean);
  const reserved = new Set(['discover', 'stream', 'you', 'charts', 'search', 'upload', 'pages', 'terms-of-use', 'mobile', 'jobs']);
  if (pathParts.length < 2 || reserved.has(pathParts[0].toLowerCase())) return undefined;
  if (['likes', 'reposts', 'tracks', 'popular-tracks'].includes(pathParts[1].toLowerCase())) return undefined;
  const kind = pathParts[1].toLowerCase() === 'sets' ? 'playlist' : 'track';
  if (kind === 'playlist' && pathParts.length < 3) return undefined;
  const canonical = new URL(`https://soundcloud.com/${pathParts.map(encodeURIComponent).join('/')}`);
  const secretToken = url.searchParams.get('secret_token');
  if (secretToken) canonical.searchParams.set('secret_token', secretToken);
  return {
    provider: 'soundcloud',
    sourceUrl: canonical.toString(),
    playbackUrl: canonical.toString(),
    fingerprint: `${kind}:${canonical.pathname}${canonical.search}`,
    kind,
  };
}

function parseSoundCloud(rawUrl: string): ParsedMedia | undefined {
  const url = safeUrl(rawUrl);
  if (!url) return undefined;
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'w.soundcloud.com' && url.pathname.startsWith('/player')) {
    const target = url.searchParams.get('url');
    return target ? parseSoundCloudTarget(target) : undefined;
  }
  return parseSoundCloudTarget(rawUrl);
}

export function parseSupportedMedia(rawUrl: string): ParsedMedia | undefined {
  return parseYouTube(rawUrl) ?? parseSoundCloud(rawUrl);
}

function isBandcamp(rawUrl: string): boolean {
  const url = safeUrl(rawUrl);
  return Boolean(url && (url.hostname.toLowerCase() === 'bandcamp.com' || url.hostname.toLowerCase().endsWith('.bandcamp.com')));
}

function closestShortBlock(document: CheerioAPI, element: AnyNode): Cheerio<AnyNode> {
  let current = document(element).parent();
  for (let depth = 0; depth < 10 && current.length; depth += 1) {
    const tagName = current.prop('tagName')?.toLowerCase();
    if (tagName && /^(h[1-6]|p|div|li)$/.test(tagName)) return current;
    current = current.parent();
  }
  return document(element).parent();
}

function isAttributionBlock(block: Cheerio<AnyNode>): boolean {
  const style = (block.attr('style') ?? '').toLowerCase();
  return /font-size:\s*(?:8|9|10|11|12)px/.test(style) && (/color:\s*#c{3,6}/.test(style) || style.includes('line-break'));
}

function getHeadingContext(headings: HeadingContext[], order: number): HeadingContext[] {
  return headings.filter((heading) => heading.order < order && order - heading.order <= 50).slice(-8).reverse();
}

function isSectionLabel(value: string): boolean {
  return /^(?:notable releases|craziest moment|related|recommended|further listening|favorite albums?|albums? i missed)\b/i.test(stripRank(value));
}

function isPlatformOnlyLabel(value: string): boolean {
  const parts = stripRank(value).split(/\s*(?:\||\/|,|·)\s*/).filter(Boolean);
  return parts.length > 0 && parts.every((part) => /^(?:spotify|apple music|soundcloud|youtube|you tube|bandcamp|listen|link)$/i.test(part));
}

function isLabelLike(value: string): boolean {
  const normalized = stripRank(value);
  const words = normalized.split(/\s+/).filter(Boolean);
  const sentenceBreaks = normalized.match(/[.!?](?:\s|$)/g)?.length ?? 0;
  return normalized.length > 0 && normalized.length <= 220 && words.length <= 30 && sentenceBreaks <= 1;
}

function inferLabel(anchorText: string, blockText: string, contexts: HeadingContext[]): string {
  const cleanAnchor = stripRank(anchorText);
  const cleanBlock = stripRank(blockText);
  if (cleanAnchor && !/^(soundcloud|youtube|you tube|listen|link)$/i.test(cleanAnchor)) {
    return isLabelLike(cleanBlock) ? cleanBlock : cleanAnchor;
  }
  const usefulContext = (context: HeadingContext): boolean => {
    const text = stripRank(context.text);
    return Boolean(text
      && isLabelLike(text)
      && !isSectionLabel(text)
      && !isPlatformOnlyLabel(text)
      && !/^(soundcloud|youtube|bandcamp|spotify|apple music|listen)$/i.test(text)
      && !/^\d{1,3}$/.test(text));
  };
  const contextual = contexts.find((context) => context.rank !== undefined && usefulContext(context))
    ?? contexts.find(usefulContext);
  return contextual ? stripRank(contextual.text) : isLabelLike(cleanBlock) ? cleanBlock : cleanAnchor;
}

function inferRank(blockText: string, contexts: HeadingContext[], type: 'anchor' | 'iframe'): number | undefined {
  const localRanks = extractRanks(blockText);
  const localRank = type === 'anchor' || (isLabelLike(blockText) && localRanks.length === 1) ? extractRank(blockText) : undefined;
  if (localRank !== undefined) return localRank;
  const genericBlock = isPlatformOnlyLabel(blockText);
  return type === 'iframe' || genericBlock ? contexts.find((context) => context.rank)?.rank : undefined;
}

function textBeforeTarget(root: AnyNode, target: AnyNode): string {
  let foundTarget = false;
  let text = '';
  const visit = (node: AnyNode): void => {
    if (foundTarget) return;
    if (node === target) {
      foundTarget = true;
      return;
    }
    if (node.type === 'text') text += node.data;
    if ('children' in node) node.children.forEach(visit);
  };
  visit(root);
  return normalizeText(text);
}

function isCuratedAnchor(block: Cheerio<AnyNode>, anchor: Cheerio<AnyNode>, rank: number | undefined): boolean {
  if (isAttributionBlock(block)) return false;
  const blockText = normalizeText(block.text());
  const anchorText = normalizeText(anchor.text());
  const tagName = block.prop('tagName')?.toLowerCase() ?? '';
  if (/^must\s+listen\s*:/i.test(blockText)) return false;
  if (/^h[1-6]$/.test(tagName)) return blockText.length <= 500;
  if (rank !== undefined) {
    if (blockText.length <= 320) return true;
    const precedingText = textBeforeTarget(block.get(0)!, anchor.get(0)!);
    const previousAnchor = anchor.prevAll('a[href]').first();
    const sameAsPrevious = previousAnchor.length > 0 && previousAnchor.attr('href') === anchor.attr('href');
    return precedingText.length <= 40 || sameAsPrevious;
  }
  if (blockText.length > 320 || !anchorText) return false;
  return anchorText.length / Math.max(blockText.length, 1) >= 0.45;
}

function findAttribution(document: CheerioAPI, elementOrder: WeakMap<object, number>, iframeOrder: number, provider: Provider): { label: string; sourceUrl: string } | undefined {
  let result: { label: string; sourceUrl: string } | undefined;
  document('a[href]').each((unusedIndex, anchorElement) => {
    if (result) return;
    const order = elementOrder.get(anchorElement as object) ?? Number.MAX_SAFE_INTEGER;
    if (order <= iframeOrder || order - iframeOrder > 12) return;
    const anchor = document(anchorElement);
    const block = closestShortBlock(document, anchorElement);
    if (!isAttributionBlock(block)) return;
    const media = parseSupportedMedia(anchor.attr('href') ?? '');
    if (!media || media.provider !== provider) return;
    const label = normalizeText(anchor.attr('title') ?? anchor.text());
    if (label) result = { label, sourceUrl: media.sourceUrl };
  });
  return result;
}

function splitLabel(label: string): { artist: string; title: string } {
  const delimiter = label.match(/\s+(?:-|–|—)\s+/);
  if (!delimiter || delimiter.index === undefined) return { artist: '', title: label };
  const artist = label.slice(0, delimiter.index).trim();
  const title = label.slice(delimiter.index + delimiter[0].length).trim();
  return title ? { artist, title } : { artist: '', title: label };
}

function stableId(...parts: Array<string | number>): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 20);
}

function postIdentity(entry: BloggerEntry): string {
  const rawId = entry.id.$t;
  return rawId.match(/post-(\d+)$/)?.[1] ?? stableId(rawId);
}

function extractMediaEvents(document: CheerioAPI): { events: MediaEvent[]; bandcamp: number; other: number; skippedSources: AnyNode[] } {
  const elementOrder = new WeakMap<object, number>();
  document('*').each((order, element) => {
    elementOrder.set(element as object, order);
  });
  const headings: HeadingContext[] = [];
  document('h1,h2,h3,h4,h5,h6,strong,b').each((unusedIndex, element) => {
    const text = normalizeText(document(element).clone().find('iframe').remove().end().text());
    if (text && text.length <= 500) headings.push({ order: elementOrder.get(element as object) ?? 0, text, rank: extractRank(text) });
  });

  const events: MediaEvent[] = [];
  const bandcampEvents: Array<{ type: 'anchor' | 'iframe'; order: number }> = [];
  const skippedSources: AnyNode[] = [];
  let other = 0;

  document('a[href],iframe[src]').each((unusedIndex, element) => {
    const node = document(element);
    const type = element.tagName.toLowerCase() === 'iframe' ? 'iframe' : 'anchor';
    const rawUrl = node.attr(type === 'iframe' ? 'src' : 'href') ?? '';
    const order = elementOrder.get(element as object) ?? 0;
    if (isBandcamp(rawUrl)) {
      const block = closestShortBlock(document, element);
      const rank = extractRank(normalizeText(block.text()));
      if (type === 'iframe' || isCuratedAnchor(block, node, rank)) {
        bandcampEvents.push({ type, order });
        skippedSources.push(element);
      }
      return;
    }
    const media = parseSupportedMedia(rawUrl);
    if (!media) {
      if (type === 'iframe' && /^https?:/i.test(rawUrl)) other += 1;
      return;
    }
    const block = closestShortBlock(document, element);
    const blockText = normalizeText(block.clone().find('iframe').remove().end().text());
    const contexts = getHeadingContext(headings, order);
    const localRanks = extractRanks(blockText);
    const localRank = type === 'anchor' || (isLabelLike(blockText) && localRanks.length === 1) ? extractRank(blockText) : undefined;
    const rank = inferRank(blockText, contexts, type);
    if (type === 'anchor' && !isCuratedAnchor(block, node, localRank)) return;
    const attribution = type === 'iframe' ? findAttribution(document, elementOrder, order, media.provider) : undefined;
    const contextualLabel = inferLabel('', blockText, contexts);
    const label = type === 'anchor'
      ? inferLabel(node.text(), blockText, contexts)
      : stripRank(contextualLabel || attribution?.label || '');
    events.push({
      nodes: [element],
      type,
      order,
      blockOrder: elementOrder.get(block.get(0) as object) ?? order,
      joinsNextAnchor: type === 'anchor' && element.nextSibling?.type === 'tag' && element.nextSibling.tagName.toLowerCase() === 'a',
      media,
      label,
      rank,
      attribution,
    });
  });

  let bandcamp = 0;
  for (let index = 0; index < bandcampEvents.length; index += 1) {
    const current = bandcampEvents[index];
    const next = bandcampEvents[index + 1];
    bandcamp += 1;
    if (current.type === 'anchor' && next?.type === 'iframe' && next.order - current.order <= 10) index += 1;
  }
  return { events, bandcamp, other, skippedSources };
}

function eventsToTracks(events: MediaEvent[], postId: string, singleTrackPerRank: boolean): TrackSelection[] {
  const normalizedEvents: MediaEvent[] = [];
  for (let index = 0; index < events.length; index += 1) {
    let event = events[index];
    const duplicateAnchor = events[index + 1];
    if (
      event.type === 'anchor'
      && duplicateAnchor?.type === 'anchor'
      && (
        event.media.fingerprint === duplicateAnchor.media.fingerprint
        || (
          event.joinsNextAnchor
          && event.blockOrder === duplicateAnchor.blockOrder
          && event.media.provider === duplicateAnchor.media.provider
          && event.rank === duplicateAnchor.rank
        )
      )
      && (event.rank === duplicateAnchor.rank || event.rank === undefined || duplicateAnchor.rank === undefined)
    ) {
      const firstLabel = stripRank(event.label);
      const secondLabel = stripRank(duplicateAnchor.label);
      const combinedLabel = firstLabel.includes(secondLabel)
        ? firstLabel
        : secondLabel.includes(firstLabel)
          ? secondLabel
          : normalizeText(`${firstLabel} ${secondLabel}`);
      event = { ...event, nodes: [...event.nodes, ...duplicateAnchor.nodes], label: combinedLabel, rank: event.rank ?? duplicateAnchor.rank };
      index += 1;
    }
    normalizedEvents.push(event);
  }

  const selections: TrackSelection[] = [];
  const representedRanks = new Set<number>();
  const rankedAnchors = normalizedEvents.filter((event) => event.type === 'anchor' && event.rank !== undefined);
  const firstRankedOrder = rankedAnchors[0]?.order;
  const lastRankedOrder = rankedAnchors.at(-1)?.order;

  const appendTrack = (mediaEvent: MediaEvent, label: string, rank: number | undefined, sourceUrl: string, sources = mediaEvent.nodes): void => {
    if (singleTrackPerRank && rank !== undefined && representedRanks.has(rank)) return;
    const cleanLabel = stripRank(label || mediaEvent.attribution?.label || `${mediaEvent.media.provider === 'youtube' ? 'YouTube' : 'SoundCloud'} ${mediaEvent.media.kind}`);
    const { artist, title } = splitLabel(cleanLabel);
    const position = selections.length + 1;
    const track: Track = {
      id: stableId(postId, position, mediaEvent.media.provider, mediaEvent.media.fingerprint),
      provider: mediaEvent.media.provider,
      title,
      artist,
      label: cleanLabel,
      sourceUrl,
      playbackUrl: mediaEvent.media.playbackUrl,
      videoId: mediaEvent.media.videoId,
      playlistId: mediaEvent.media.playlistId,
      rank,
      position,
      kind: mediaEvent.media.kind,
      startSeconds: mediaEvent.media.startSeconds,
    };
    selections.push({ track, sources });
    if (rank !== undefined) representedRanks.add(rank);
  };

  for (let index = 0; index < normalizedEvents.length; index += 1) {
    const event = normalizedEvents[index];
    const outsideRankedList = event.rank === undefined
      && rankedAnchors.length >= 20
      && firstRankedOrder !== undefined
      && lastRankedOrder !== undefined
      && (event.order < firstRankedOrder || event.order > lastRankedOrder);
    if (event.type === 'iframe' && event.media.kind === 'playlist' && outsideRankedList) continue;
    if (event.type === 'iframe') {
      appendTrack(event, event.label, event.rank, event.attribution?.sourceUrl ?? event.media.sourceUrl);
      continue;
    }

    let pairedIframeIndex = -1;
    for (let candidateIndex = index + 1; candidateIndex < normalizedEvents.length; candidateIndex += 1) {
      const candidate = normalizedEvents[candidateIndex];
      if (candidate.type === 'anchor' && candidate.rank !== undefined && event.rank !== undefined && candidate.rank !== event.rank) break;
      if (candidate.type !== 'iframe') continue;
      const sameRank = event.rank !== undefined && candidate.rank === event.rank;
      const sameMedia = event.media.fingerprint === candidate.media.fingerprint;
      const matchingAttribution = candidate.attribution?.sourceUrl === event.media.sourceUrl;
      const nearbyEntryIframe = candidateIndex === index + 1
        && candidate.order - event.order <= 8;
      if (sameRank || sameMedia || matchingAttribution || nearbyEntryIframe) pairedIframeIndex = candidateIndex;
      break;
    }

    if (pairedIframeIndex !== -1) {
      const iframeEvent = normalizedEvents[pairedIframeIndex];
      const labels = normalizedEvents
        .slice(index, pairedIframeIndex + 1)
        .filter((candidate) => candidate.type === 'anchor' && candidate.rank === event.rank)
        .map((candidate) => candidate.label)
        .filter((candidate) => candidate && !isSectionLabel(candidate));
      const label = labels.sort((left, right) => right.length - left.length)[0] ?? event.label ?? iframeEvent.label;
      const sourceUrl = iframeEvent.media.provider === event.media.provider
        ? event.media.sourceUrl
        : iframeEvent.attribution?.sourceUrl ?? iframeEvent.media.sourceUrl;
      const sources = normalizedEvents.slice(index, pairedIframeIndex + 1).flatMap((candidate) => candidate.nodes);
      appendTrack(iframeEvent, label, event.rank ?? iframeEvent.rank, sourceUrl, sources);
      index = pairedIframeIndex;
      continue;
    }

    if (event.rank !== undefined) appendTrack(event, event.label, event.rank, event.media.sourceUrl);
  }
  return selections;
}

function deriveShortTitle(title: string): string {
  const normalized = normalizeText(title);
  const monthly = normalized.match(new RegExp(`(?:favorite (?:music|songs)(?: from| of)?)[^a-z]*(${MONTHS.join('|')})\\s+(20\\d{2})`, 'i'));
  if (monthly) return `${monthly[1][0].toUpperCase()}${monthly[1].slice(1).toLowerCase()} ${monthly[2]}`;
  return normalized
    .replace(/^creeedoooo\s*-\s*/i, '')
    .replace(/^billdifferen['’]s\s*/i, '')
    .replace(/^da\s+billdifferen\s*/i, '')
    .trim();
}

function deriveCategory(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('roundup')) return 'Roundups';
  if (lower.includes('jersey')) return 'Jersey club';
  if (lower.includes('baile funk') || lower.includes('funk songs')) return 'Baile funk';
  if (MONTHS.some((month) => lower.includes(month)) && /favorite (music|songs)/.test(lower)) return 'Monthly';
  if (lower.includes('so far')) return 'Midyear';
  if (/(top|best|favorite).*(20\d{2}|2k\d{2})/.test(lower)) return 'Year-end';
  return 'Features';
}

function deriveYear(title: string, publishedAt: string): number {
  const standardYear = title.match(/20\d{2}/)?.[0];
  const compactYear = title.match(/2k(\d{2})/i)?.[1];
  if (standardYear) return Number(standardYear);
  if (compactYear) return 2000 + Number(compactYear);
  return new Date(publishedAt).getUTCFullYear();
}

function safeArtworkUrl(document: CheerioAPI, entry: BloggerEntry): string | undefined {
  const candidates = [document('img[src]').first().attr('src'), entry.media$thumbnail?.url];
  for (const candidate of candidates) {
    const url = candidate ? safeUrl(candidate) : undefined;
    if (!url || !['http:', 'https:'].includes(url.protocol)) continue;
    url.pathname = url.pathname.replace(/\/s\d+(?:-[^/]+)?\//, '/w640/');
    return url.toString();
  }
  return undefined;
}

export function parsePost(entry: BloggerEntry): Playlist | undefined {
  const document = cheerio.load(entry.content.$t);
  const postId = postIdentity(entry);
  const extracted = extractMediaEvents(document);
  const title = normalizeText(entry.title.$t);
  const singleTrackPerRank = /(?:top|favorite)\s+\d+\s+releases/i.test(title);
  const selections = eventsToTracks(extracted.events, postId, singleTrackPerRank);
  attachTrackDescriptions(document, selections, extracted.skippedSources);
  const tracks = selections.map((selection) => selection.track);
  if (tracks.length === 0) return undefined;
  const sourceUrl = entry.link?.find((link) => link.rel === 'alternate')?.href ?? BLOG_URL;
  return {
    id: postId,
    title,
    shortTitle: deriveShortTitle(title),
    category: deriveCategory(title),
    publishedAt: entry.published.$t,
    updatedAt: entry.updated.$t,
    year: deriveYear(title, entry.published.$t),
    sourceUrl,
    artworkUrl: safeArtworkUrl(document, entry),
    tracks,
    skipped: { bandcamp: extracted.bandcamp, other: extracted.other },
  };
}

export function validateCatalog(catalog: Catalog): void {
  if (catalog.schemaVersion !== 2) throw new Error('Unsupported catalog schema');
  if (!Number.isInteger(catalog.totalPosts) || catalog.totalPosts < 1) throw new Error('Catalog has no source posts');
  if (catalog.playlists.length > catalog.totalPosts) throw new Error('Catalog has more playlists than posts');
  const playlistIds = new Set<string>();
  for (const playlist of catalog.playlists) {
    if (playlistIds.has(playlist.id)) throw new Error(`Duplicate playlist id: ${playlist.id}`);
    playlistIds.add(playlist.id);
    if (playlist.tracks.length === 0) throw new Error(`Playlist has no tracks: ${playlist.title}`);
    playlist.tracks.forEach((track, index) => {
      if (track.position !== index + 1) throw new Error(`Invalid track positions in: ${playlist.title}`);
      if (track.description !== undefined && (typeof track.description !== 'string' || !track.description.trim())) {
        throw new Error(`Invalid track description in: ${playlist.title}`);
      }
    });
  }
}

async function fetchFeedPage(fetchImpl: typeof fetch, startIndex: number, pageSize: number, timeoutMs: number): Promise<BloggerFeedPage> {
  const url = new URL(FEED_URL);
  url.searchParams.set('alt', 'json');
  url.searchParams.set('max-results', String(pageSize));
  url.searchParams.set('start-index', String(startIndex));
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Blogger returned ${response.status} for page starting at ${startIndex}`);
  return response.json() as Promise<BloggerFeedPage>;
}

export async function importCatalog(options: ImportOptions = {}): Promise<Catalog> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pageSize = options.pageSize ?? FEED_PAGE_SIZE;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const entries: BloggerEntry[] = [];
  const seenIds = new Set<string>();
  let expectedTotal: number | undefined;

  for (let startIndex = 1; expectedTotal === undefined || startIndex <= expectedTotal; startIndex += pageSize) {
    const page = await fetchFeedPage(fetchImpl, startIndex, pageSize, timeoutMs);
    const pageEntries = page.feed?.entry ?? [];
    const reportedTotal = Number(page.feed?.openSearch$totalResults?.$t);
    if (!Number.isInteger(reportedTotal) || reportedTotal < 0) throw new Error('Blogger feed omitted a valid total result count');
    if (expectedTotal !== undefined && reportedTotal !== expectedTotal) throw new Error('Blogger total changed during pagination');
    expectedTotal = reportedTotal;
    for (const entry of pageEntries) {
      if (!seenIds.has(entry.id.$t)) {
        entries.push(entry);
        seenIds.add(entry.id.$t);
      }
    }
    if (pageEntries.length === 0 && entries.length < expectedTotal) throw new Error('Blogger pagination ended before the complete archive was fetched');
  }

  if (expectedTotal === undefined || entries.length !== expectedTotal) {
    throw new Error(`Incomplete Blogger snapshot: received ${entries.length} of ${expectedTotal ?? 'unknown'} posts`);
  }
  const playlists = entries.flatMap((entry) => {
    const playlist = parsePost(entry);
    return playlist ? [playlist] : [];
  });
  const catalog: Catalog = {
    schemaVersion: 2,
    source: { title: SOURCE_TITLE, url: BLOG_URL },
    fetchedAt: (options.now ?? new Date()).toISOString(),
    totalPosts: expectedTotal,
    playlists,
  };
  validateCatalog(catalog);
  return catalog;
}
