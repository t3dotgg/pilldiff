# pilldiff

An unofficial, local-first player for the playlists and music posts published at [billdifferen](https://billdifferen.blogspot.com/). It keeps each post's original document order, supports reverse playback, and hands tracks between official YouTube and SoundCloud embeds. Bandcamp entries are counted but skipped for now.

The interface takes its black, white, and red palette from the blog, with the original post artwork as a wide banner. Entries with commentary have expandable **Bill’s notes** in the tracklist; the current song's notes also appear beneath its source player. The archive marks playlists that contain notes. Not every post has them, particularly the recent link-only monthly lists.

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

## Deployment

This is one Node.js web service, not a static-only Vite site. The same process serves the built frontend and catalog API. No database, provider API keys, authentication setup, or separate worker is required. Audio and video stream directly from the official provider embeds, not through this server.

### Railway

The included multi-stage `Dockerfile` provides the build and start commands, Node 24, a non-root runtime, and a writable catalog cache. Railway detects the root Dockerfile automatically.

When ready to publish:

1. Push this Git repository to GitHub and connect it as a Railway service. Alternatively, deploy this directory with the Railway CLI after selecting the intended project and service.
2. Set `PORT=8080`. The Dockerfile already sets `HOST=0.0.0.0` and `NODE_ENV=production`; no secrets are needed.
3. Set the service's healthcheck path to `/api/health` in its deployment settings. Configure this explicitly even though the Docker image also contains a local healthcheck.
4. Generate a public domain under Networking, targeting port `8080`. Railway handles HTTPS; a custom domain is optional.
5. Wait for a successful deployment and healthcheck, then open the public URL and test playback with a real click. Check both YouTube-to-SoundCloud and SoundCloud-to-YouTube transitions in the intended browser.

There is no Railway project, domain, or account configuration checked into this repository. Adding these files does not deploy anything or create billable resources. Hosting charges depend on the provider plan and actual usage.

### Run the container locally

With a running Docker engine:

```sh
docker build -t pilldiff .
docker run --rm -p 127.0.0.1:8080:8080 pilldiff
```

Open `http://127.0.0.1:8080`. The container includes the seed catalog and built frontend, and installs only production dependencies in its runtime stage. `PORT` is read at runtime, so another host can supply its own value.

Without Docker, the equivalent production commands on any Node 24 host are:

```sh
npm ci
npm run build
npm prune --omit=dev
HOST=0.0.0.0 PORT=8080 npm start
```

Pruning is intended for a deployment checkout; use `npm ci` again before developing or building there. Put HTTPS in front of the service when hosting it publicly. Do not remove the server's `strict-origin-when-cross-origin` Referrer-Policy or add a restrictive iframe policy that blocks the YouTube and SoundCloud players.

### Catalog storage and updates

The checked-in seed makes cold starts independent of Blogger availability. The **Refresh** button fetches the complete source feed and writes `.cache/catalog.json`; failed refreshes leave the last known catalog intact. Refresh is same-origin checked, deduplicated, and limited by a per-process cooldown. It is not an admin-only endpoint.

The cache is disposable: a new deployment or replacement container starts from the bundled seed unless persistent storage is configured. No volume is needed for the first deployment. Use **Refresh** after a redeploy to pick up new posts, or run `npm run sync` locally and commit the updated seed before releasing. Playback preferences stay in each listener's browser. For a simple personal deployment, keep one replica; cache and refresh coordination are not shared across replicas.

### Typeface

The wordmark uses the same UnifrakturMaguntia typeface as the original blog. It is self-hosted, so the interface does not request Google Fonts at runtime. Its SIL Open Font License is included in `public/fonts/OFL.txt`.
