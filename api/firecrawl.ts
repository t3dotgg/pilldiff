import { handleFirecrawlWebhook } from '../server/firecrawl-webhook.js';

export default {
  fetch(request: Request): Promise<Response> {
    return handleFirecrawlWebhook(request, {
      env: process.env,
      fetch: globalThis.fetch,
    });
  },
};
