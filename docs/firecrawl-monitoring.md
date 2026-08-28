# Firecrawl monitoring

Firecrawl is optional. The deployed player remains a static Vite site; Firecrawl checks the source blog and sends every subscribed check-completion result, including unchanged checks, to the small `/api/firecrawl` function. That function authenticates the notification, filters for a new, changed, or removed page, and asks Vercel to rebuild only when needed. The build still imports the catalog directly from Blogger.

Monitoring is scheduled rather than instantaneous. A source edit becomes visible after the next Firecrawl check and a successful Vercel build.

The suggested weekly cadence favors lower external credit use. Changing it to daily or hourly shortens detection time while increasing the number of pages checked and credits consumed.

## Before creating the monitor

1. Deploy the Git-connected project to Vercel once without a Firecrawl callback.
2. In Vercel, open **Settings → Git → Deploy Hooks** and create a hook for `main`. Treat the entire URL as a credential.
3. In Firecrawl, create the monitor without a webhook or keep it paused. Record its ID and avoid creating duplicate monitors while finishing setup.
4. In the Firecrawl account **Advanced** settings, copy the webhook signing secret. This is not the Firecrawl API key.
5. Add these Production environment variables to Vercel and redeploy so the function receives them:

   - `FIRECRAWL_WEBHOOK_SECRET`: the account webhook signing secret.
   - `FIRECRAWL_MONITOR_ID`: the ID of this one monitor.
   - `VERCEL_DEPLOY_HOOK`: the secret Vercel deploy-hook URL for `main`.

6. Set the monitor webhook to `https://YOUR_PRODUCTION_DOMAIN/api/firecrawl`, subscribe only to `monitor.check.completed`, then enable or resume the monitor.

The app and GitHub do not need a Firecrawl API key. Never use a `VITE_` prefix for any of these values, commit them, log them, or put the Vercel hook directly in Firecrawl. Direct delivery to the deploy hook would rebuild even for unchanged checks and would bypass signature and monitor-ID validation.

## Suggested monitor

Configure a website monitor with a `crawl` target. The blog homepage currently contains only a few recent snippets, so monitoring only the homepage will not detect edits to archived posts. The blog's `sitemap.xml` currently lists all 40 post URLs directly; check the first run to confirm the crawl discovered that archive and raise the page limit as it grows.

This JSON is a starting point for the Firecrawl dashboard or `POST /v2/monitor` request body:

```json
{
  "name": "billdifferen playlist changes",
  "schedule": {
    "text": "weekly",
    "timezone": "America/Los_Angeles"
  },
  "judgeEnabled": false,
  "targets": [
    {
      "type": "crawl",
      "url": "https://billdifferen.blogspot.com/",
      "crawlOptions": {
        "limit": 75,
        "sitemap": "only",
        "ignoreQueryParameters": true
      },
      "scrapeOptions": {
        "formats": ["markdown"],
        "onlyMainContent": true,
        "includeTags": [".blog-posts"]
      }
    }
  ]
}
```

After the Vercel variables are active, add this webhook configuration to that same monitor:

```json
{
  "webhook": {
    "url": "https://YOUR_PRODUCTION_DOMAIN/api/firecrawl",
    "events": ["monitor.check.completed"]
  }
}
```

`sitemap: "only"` uses the sitemap plus the starting URL without spending the page budget on HTML-discovered archive, search, or query variants. `ignoreQueryParameters: true` keeps query-string variants from becoming separate monitored pages. The `.blog-posts` selector includes post titles and bodies while excluding most surrounding blog chrome; `.post-body` is a narrower alternative if the first diff still contains noise. Inspect the first check before relying on either selector. Firecrawl stores the comparison baseline and performs fresh scrapes for monitor checks by default. `judgeEnabled: false` keeps the trigger based on the completed check's summary counts rather than an AI judgment. Do not subscribe to `monitor.page`: it emits once per page and can create a burst of redundant builds. Optional change and error email notifications can be enabled separately in the Firecrawl dashboard.

The page limit is intentionally bounded because monitoring uses external credits per discovered page and check. Review Firecrawl's estimated usage after the first crawl; pricing and plan limits belong to the Firecrawl account and can change.

## Detection limits

Firecrawl's default monitor comparison diffs scraped Markdown. It should detect added posts and textual edits within the post body, but a change that only swaps an iframe or media source may not appear in that Markdown diff. A whole-blog crawl covers discovered pages; it does not guarantee coverage of URLs omitted by discovery or excluded by the page limit.

When a source change is missed or an immediate refresh is useful, run **Actions → Rebuild catalog → Run workflow** in GitHub. That workflow asks Vercel for a new build without waiting for Firecrawl.

## Failure behavior

The webhook accepts only correctly signed `monitor.check.completed` events for the configured monitor. Failed or partial checks, checks with page errors, unchanged checks, and unrelated events return successfully without requesting a build. A valid changed check returns `202` after Vercel accepts the deploy-hook request. Acceptance means the build was queued, not that it finished successfully.

If Blogger import or catalog validation fails during a build, Vercel keeps the existing production deployment. Firecrawl retries can request duplicate builds, so occasional duplicates are possible; the endpoint deliberately has no database or unreliable in-memory deduplication.

Official references:

- [Firecrawl website monitoring](https://docs.firecrawl.dev/features/monitoring-website)
- [Firecrawl monitor events](https://docs.firecrawl.dev/webhooks/events)
- [Firecrawl webhook signatures](https://docs.firecrawl.dev/webhooks/security)
- [Vercel deploy hooks](https://vercel.com/docs/deploy-hooks)
- [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js)
