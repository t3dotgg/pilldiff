# pilldiff

An unofficial, local-first player for the playlists and music posts published at [billdifferen](https://billdifferen.blogspot.com/). It keeps each post's original document order, supports reverse playback, and hands tracks between official YouTube and SoundCloud embeds. Bandcamp entries are counted but skipped for now.

The interface takes its black, white, and red palette from the blog, with the original post artwork as a wide banner. Entries with commentary have expandable **Bill’s notes** in the tracklist; the current song's notes also appear beneath its source player. The archive marks playlists that contain notes. Not every post has them, particularly the recent link-only monthly lists.

Click the song or playlist label in the bottom player, or the song title beneath the source player, to return to the playing playlist and reveal the current track. This preserves playback, progress, and order, and works even when you are already viewing that playlist.

## Run locally

Requires Node.js 24.x.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Keeping the app on a normal local HTTP origin matters: YouTube embeds rely on an origin and Referer, and the app sends `strict-origin-when-cross-origin` for that reason. Local development uses the committed catalog snapshot and does not contact Blogger.

Other commands:

```sh
npm test
npx playwright install chromium
npm run test:e2e
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
npm run build
npm run build:snapshot
npm start
npm run sync
```

`npm run build` imports and validates the live Blogger feed before creating the static `dist` directory. It fails instead of silently publishing stale data when the live import is unavailable or invalid. `npm run build:snapshot` creates the same frontend from the committed `data/catalog.json` without network access. `npm start` previews the most recent build on `http://127.0.0.1:4173`.

`npm run test:e2e` is the deterministic browser suite: it mocks both provider SDKs and uses Playwright's installed Chromium by default. Run `npx playwright install chromium` once on a fresh machine, or set `PLAYWRIGHT_CHANNEL=chrome` to use system Chrome.

The optional live smoke check drives the real provider embeds and can be affected by autoplay policy, ads, availability, or network conditions. Start the app first, then run:

```sh
PLAYWRIGHT_CHANNEL=chrome npm run test:live
```

Set `PLAYWRIGHT_BASE_URL` when the app is not on `http://127.0.0.1:5173`, or set `PILLDIFF_LIVE_HANDOFF=0` to skip its near-end handoff attempt.

## Favicon

The approved Blackletter B lives in `public/favicon.svg`. The app also includes a 16/32/48-pixel `public/favicon.ico` and an opaque 180-pixel `public/apple-touch-icon.png`, both generated from that SVG.

After editing the SVG, regenerate the raster assets with `npm run icons` (or `PLAYWRIGHT_CHANNEL=chrome npm run icons` for system Chrome), then commit all three assets. This uses the existing Playwright tooling and is not part of the production build.

## How it works

- `server/importer.ts` reads every page of the fixed Blogger JSON feed, treats native embeds and ranked link-only entries as the playlist, pairs cross-provider headings with their embed, and excludes posts with no supported tracks.
- A production build writes the validated result to ignored `public/catalog.json`, then Vite includes it as static `/catalog.json` in `dist`.
- `data/catalog.json` is the checked-in snapshot for deterministic offline development and builds. `npm run sync` deliberately refreshes that snapshot atomically.
- The archive's **Check for updates** action only reloads the currently deployed `/catalog.json`; it never imports Blogger or starts a deployment.
- `api/firecrawl.ts` is an optional signed webhook that filters Firecrawl change notifications and requests a Vercel rebuild. It does not serve catalog data.
- `shared/types.ts` is the contract used by the importer and React client.

The catalog stores post metadata, media URLs or IDs, and Bill's per-entry commentary when present. Notes are plain text with paragraph breaks, not executable blog HTML. The importer keeps them within entry boundaries, skips widget attribution and unrelated post introductions, and does not invent notes for link-only lists. Schema version 2 invalidates older catalog snapshots that lack this enrichment. The importer only contacts the fixed `billdifferen.blogspot.com` feed and is not a general-purpose fetch proxy. Catalog import and playback use no API keys, accounts, media downloads, or unofficial streams.

## Playlist links

Each playlist has a shareable `/playlists/<playlist-id>` URL using its stable Blogger string ID. Opening `/` replaces the address with the latest playlist's canonical URL. Refreshing, copying a link, opening it in a new tab, and browser Back/Forward keep the browsed playlist in sync with the address. Missing or removed playlists show a not-found view with a recovery link instead of silently displaying a different playlist.

The URL identifies the playlist being browsed, not the playback queue, order, track, or timestamp. Navigation leaves active playback unchanged. A fresh deep link with no saved session cues that playlist paused; an existing valid saved session restores paused independently of the playlist being viewed.

## Playback notes

Browsers require an initial user gesture before autoplay with sound. Provider policy can also require another click during a YouTube-to-SoundCloud handoff. Ads, removed uploads, private tracks, region restrictions, and provider-side embed blocks remain under YouTube or SoundCloud control.

Unit tests exercise parser ordering, link normalization, provider pairing, Bandcamp skipping, pagination, catalog-generation failure safety, playback queues, and webhook filtering with small synthetic fixtures. Browser tests use mocked provider APIs to verify app orchestration; they do not guarantee that a live third-party embed will autoplay in a particular browser session.

Source playlists and editorial selection are by billdifferen. This project is unofficial and is not affiliated with the blog, YouTube, or SoundCloud.

## Deployment

The player is a static Vite frontend on Vercel. Catalog import happens during the build, playback runs in the browser through official provider embeds, and listener preferences stay in browser storage. There is no application server, database, KV store, writable cache, volume, authentication system, media proxy, or background worker.

The only optional runtime code is `/api/firecrawl`, a small Vercel function that can receive a signed source-change notification and call a deploy hook. It never imports the catalog, handles playback, or stores state.

### Vercel

Production target: [pilldiff.t3.gg](https://pilldiff.t3.gg/). The private source repository is [t3dotgg/pilldiff](https://github.com/t3dotgg/pilldiff), connected from `main` to the existing `theo-personal/pilldiff` Vercel project. Pushes to `main` automatically start a fresh Blogger import and production build.

1. Push this repository to GitHub and import it as a Git-connected Vercel project.
2. Vercel reads `vercel.json`, runs `npm run build` with Node 24, and publishes `dist`.
3. Deploy once with no environment variables if automatic monitoring is not ready yet. The static player and build-time catalog need no credentials.
4. Open the production URL and test a real YouTube-to-SoundCloud and SoundCloud-to-YouTube transition after an initial click.

`vercel.json` rewrites only `/playlists/:path*` to `/index.html` so direct playlist visits and refreshes load the frontend. API routes, `/catalog.json`, assets, fonts, and their existing header policies are unchanged.

Every deployment imports the current Blogger feed. A failed import or validation fails the new build, so Vercel leaves the existing production deployment in place. The committed snapshot is intentionally reserved for local/offline use and is not an automatic production fallback. Keep the `strict-origin-when-cross-origin` Referrer-Policy and avoid an iframe policy that blocks YouTube or SoundCloud.

### Manual rebuild

Create a Vercel deploy hook for the `main` branch under **Project Settings → Git → Deploy Hooks**. Add its full URL as the `VERCEL_DEPLOY_HOOK` secret in the GitHub repository, then use **Actions → Rebuild catalog → Run workflow** whenever an immediate import is needed. The workflow has no schedule and does not check out or rebuild the repository itself; it asks Vercel to build the current `main` branch and import Blogger again. A green workflow means Vercel accepted the request; verify the resulting deployment in Vercel before treating the catalog as updated.

The workflow must exist on the repository's default branch before GitHub exposes **Run workflow**. Treat the deploy-hook URL as a password: do not commit it or expose it to client code.

### Automatic rebuilds

Firecrawl can monitor the blog on a schedule and notify `/api/firecrawl` when its completed check finds a new, changed, or removed page. The endpoint verifies Firecrawl's raw-body HMAC signature, accepts only the configured monitor, ignores unsuccessful or error-containing checks, and calls the same Vercel deploy hook once for a qualifying event.

Automatic monitoring requires three Vercel Production environment variables listed in `.env.example`: `FIRECRAWL_WEBHOOK_SECRET`, `FIRECRAWL_MONITOR_ID`, and `VERCEL_DEPLOY_HOOK`. No Firecrawl API key belongs in the app or GitHub. See [Firecrawl monitoring setup](docs/firecrawl-monitoring.md) for the safe setup order, whole-blog crawl configuration, detection limitations, and official references.

Creating a Firecrawl monitor requires sufficient credits on the Firecrawl account. If creation returns HTTP 402, fund the correct account and repeat the documented setup without copying API keys into the repository, GitHub, or Vercel. Until `FIRECRAWL_MONITOR_ID` is configured, the webhook intentionally returns 503; this disables automatic monitoring but does not affect the static player, Git-triggered deployments, or manual rebuild workflow.

### Typeface

The wordmark uses the same UnifrakturMaguntia typeface as the original blog. It is self-hosted, so the interface does not request Google Fonts at runtime. Its SIL Open Font License is included in `public/fonts/OFL.txt`.
