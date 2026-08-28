import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Track } from '../shared/types.js';

export interface TrackSelection {
  track: Track;
  sources: AnyNode[];
}

interface ContentBlock {
  text: string;
  heading: boolean;
  tracks: Set<Track>;
  skipped: boolean;
  media: boolean;
  separator: boolean;
}

interface EntryNotes {
  title?: string;
  rank?: number;
  tracks: Set<Track>;
  paragraphs: string[];
}

const BLOCK_TAGS = /^(?:h[1-6]|p|div|li|blockquote|section|article|figure|figcaption|ul|ol|table|tr|td)$/;
const OMIT_TAGS = /^(?:script|style|noscript|template|svg|button|form)$/;

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function withoutRank(value: string): string {
  return value.replace(/^#?\s*\d{1,3}\s*[.):;-]\s*/, '').trim();
}

function rankOf(value: string): number | undefined {
  const match = value.match(/^#?\s*(\d{1,3})\s*[.):;-]\s*/);
  return match ? Number(match[1]) : undefined;
}

function isPlatformBar(value: string): boolean {
  return value.split(/\s*(?:\||\/|,|·)\s*/).every((part) => /^(?:spotify|apple music|soundcloud|youtube|you tube|bandcamp|listen|link)$/i.test(part));
}

function isSectionBreak(value: string): boolean {
  return /^(?:notable releases|craziest moment|related|recommended|further listening|favorite albums?|albums? i missed|honou?rable mentions|thanks for (?:reading|listening)|thank you for (?:reading|listening)|that['’]s (?:all|it)(?:\b|!)|until next time|see (?:you|y['’]?all) next|full (?:list|playlist)|here['’]s (?:the|a) (?:full |whole )?playlist)\b/i.test(value);
}

function readBlocks(document: CheerioAPI, selections: TrackSelection[], skippedSources: AnyNode[]): ContentBlock[] {
  const owners = new Map<AnyNode, Track[]>();
  for (const { track, sources } of selections) {
    for (const source of sources) owners.set(source, [...(owners.get(source) ?? []), track]);
  }
  const skipped = new Set(skippedSources);
  const blocks: ContentBlock[] = [];
  let text = '';
  let heading = false;
  let tracks = new Set<Track>();
  let containsSkipped = false;

  const flush = () => {
    const normalized = cleanText(text);
    if (normalized || tracks.size || containsSkipped) {
      blocks.push({ text: normalized, heading, tracks, skipped: containsSkipped, media: false, separator: false });
    }
    text = '';
    tracks = new Set();
    containsSkipped = false;
  };

  const visit = (node: AnyNode, inHeading = false): void => {
    if (node.type === 'text') {
      text += node.data;
      heading = inHeading;
      return;
    }
    if (!('tagName' in node)) {
      if ('children' in node) node.children.forEach((child) => visit(child, inHeading));
      return;
    }
    const tag = node.tagName.toLowerCase();
    const attributes = node.attribs;
    const style = attributes.style ?? '';
    const attribution = /font-size:\s*(?:8|9|10|11|12)px/i.test(style)
      && /color:\s*#c{3,6}|line-break/i.test(style);
    if (OMIT_TAGS.test(tag) || attribution || 'hidden' in attributes || attributes['aria-hidden'] === 'true' || /display:\s*none|visibility:\s*hidden/i.test(style)) return;
    if (tag === 'iframe' || tag === 'embed' || tag === 'object' || tag === 'hr') {
      flush();
      blocks.push({ text: '', heading: false, tracks: new Set(owners.get(node)), skipped: false, media: tag !== 'hr', separator: tag === 'hr' });
      return;
    }
    if (tag === 'br') {
      flush();
      return;
    }
    const block = BLOCK_TAGS.test(tag);
    if (block) flush();
    owners.get(node)?.forEach((track) => tracks.add(track));
    if (skipped.has(node)) containsSkipped = true;
    node.children.forEach((child) => visit(child, block ? /^h[1-6]$/.test(tag) : inHeading));
    if (block) flush();
  };

  visit(document.root().get(0)!);
  flush();
  return blocks;
}

function matchesEntry(entry: EntryNotes, track: Track): boolean {
  if (entry.rank !== undefined && track.rank !== undefined) return entry.rank === track.rank;
  if (!entry.title) return false;
  const label = withoutRank(cleanText(track.label)).toLocaleLowerCase();
  const title = withoutRank(entry.title).toLocaleLowerCase();
  return Boolean(label && title && (label === title || title.startsWith(`${label} `)));
}

function inlineDescription(block: ContentBlock): string | undefined {
  const text = withoutRank(block.text);
  const labels = [...block.tracks].map((track) => track.label).sort((left, right) => right.length - left.length);
  const label = labels.find((candidate) => text.startsWith(candidate));
  if (!label) return undefined;
  const remainder = text.slice(label.length).replace(/^\s*[-–—:]\s*/, '').trim();
  return remainder && !/^[\s/|&]+$/.test(remainder) ? remainder : undefined;
}

export function attachTrackDescriptions(document: CheerioAPI, selections: TrackSelection[], skippedSources: AnyNode[]): void {
  const blocks = readBlocks(document, selections, skippedSources);
  let entry: EntryNotes | undefined;

  const finish = () => {
    if (!entry) return;
    const description = entry.paragraphs.join('\n\n').trim();
    if (description) {
      for (const track of entry.tracks) {
        if (track.rank === undefined && /^(?:YouTube|SoundCloud) (?:track|playlist)$/.test(track.label)) continue;
        track.description = description;
      }
    }
    entry = undefined;
  };

  for (const block of blocks) {
    if (block.separator || isSectionBreak(block.text)) {
      finish();
      continue;
    }
    if (block.media) {
      if (!block.tracks.size) {
        finish();
        continue;
      }
      const belongsToEntry = entry && [...block.tracks].every((track) => entry!.tracks.has(track)
        || ((entry!.rank !== undefined || entry!.tracks.size === 0) && matchesEntry(entry!, track)));
      if (!belongsToEntry) {
        finish();
        entry = { tracks: new Set(), paragraphs: [] };
      }
      block.tracks.forEach((track) => entry!.tracks.add(track));
      continue;
    }
    if (!block.text) continue;
    if (isPlatformBar(block.text)) {
      if (entry && [...block.tracks].every((track) => matchesEntry(entry!, track))) {
        block.tracks.forEach((track) => entry!.tracks.add(track));
      }
      continue;
    }
    const rank = rankOf(block.text);
    const titleHeading = block.heading && block.text.length <= 500 && !/^(?:\(|\[|must\s+listen\s*:)/i.test(block.text);
    const isTitle = rank !== undefined || titleHeading || block.skipped || block.tracks.size > 0;
    if (isTitle) {
      const sameEntry = entry && block.tracks.size > 0
        && [...block.tracks].every((track) => entry!.tracks.has(track) || matchesEntry(entry!, track));
      if (!sameEntry) {
        finish();
        entry = { title: block.text, rank, tracks: new Set(), paragraphs: [] };
      }
      block.tracks.forEach((track) => entry!.tracks.add(track));
      const inline = inlineDescription(block);
      if (inline) entry!.paragraphs.push(inline);
      continue;
    }
    if (entry) entry.paragraphs.push(block.text);
  }
  finish();
}
