# pilldiff

An unofficial, local-first player for the playlists and music posts published at [billdifferen](https://billdifferen.blogspot.com/). It keeps each post's original document order, supports reverse playback, and hands tracks between official YouTube and SoundCloud embeds. Bandcamp entries are counted but skipped for now.

## Run locally

Requires Node.js 24 or newer.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Keeping the app on a normal local HTTP origin matters: YouTube embeds rely on an origin and Referer, and the server sends `strict-origin-when-cross-origin` for that reason.

Other commands:

```sh
npm test
npx playwright install chromium
npm run test:e2e
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
npm run build
npm start
npm run sync
```

`npm run test:e2e` is the deterministic browser suite: it mocks both provider SDKs and uses Playwright's installed Chromium by default. Run `npx playwright install chromium` once on a fresh machine, or set `PLAYWRIGHT_CHANNEL=chrome` to use system Chrome.

The optional live smoke check drives the real provider embeds and can be affected by autoplay policy, ads, availability, or network conditions. Start the app first, then run:

```sh
PLAYWRIGHT_CHANNEL=chrome npm run test:live
```

Set `PLAYWRIGHT_BASE_URL` when the app is not on `http://127.0.0.1:5173`, or set `PILLDIFF_LIVE_HANDOFF=0` to skip its near-end handoff attempt. `npm start` serves the production `dist` build on port 5173; `PORT` and `HOST` can override the defaults.

## How it works

- `server/importer.ts` reads every page of the fixed Blogger JSON feed, treats native embeds and ranked link-only entries as the playlist, pairs cross-provider headings with their embed, and excludes posts with no supported tracks.
- `data/catalog.json` is the checked-in seed, so the library is available immediately without a network request.
- `GET /api/catalog` returns the newest valid disk cache or seed and marks snapshots older than 24 hours as stale.
- `POST /api/catalog/refresh` performs a same-origin, deduplicated refresh with a short cooldown. A complete validated result goes to ignored `.cache/catalog.json`; failures preserve the known-good catalog.
- `npm run sync` deliberately replaces the checked-in seed atomically. Normal app refreshes never modify tracked data.
- `shared/types.ts` is the contract used by the React client and Node server.

The catalog stores post metadata, media URLs or IDs, and Bill's per-entry commentary when present. Notes are plain text with paragraph breaks, not executable blog HTML. The importer keeps them within entry boundaries, skips widget attribution and unrelated post introductions, and does not invent notes for link-only lists. Schema version 2 invalidates older caches that lack this enrichment. The importer only contacts the fixed `billdifferen.blogspot.com` feed and is not a general-purpose fetch proxy. No API keys, accounts, media downloads, or unofficial streams are used.

## Playback notes

Browsers require an initial user gesture before autoplay with sound. Provider policy can also require another click during a YouTube-to-SoundCloud handoff. Ads, removed uploads, private tracks, region restrictions, and provider-side embed blocks remain under YouTube or SoundCloud control.

Unit tests exercise parser ordering, link normalization, provider pairing, Bandcamp skipping, pagination, and cache-failure safety with small synthetic fixtures. Browser tests use mocked provider APIs to verify app orchestration; they do not guarantee that a live third-party embed will autoplay in a particular browser session.

Source playlists and editorial selection are by billdifferen. This project is unofficial and is not affiliated with the blog, YouTube, or SoundCloud.
