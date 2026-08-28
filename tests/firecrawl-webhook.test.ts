import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  handleFirecrawlWebhook,
  type FirecrawlWebhookDependencies,
  type WebhookFetch,
} from '../server/firecrawl-webhook.js';

const WEBHOOK_SECRET = 'firecrawl-signing-secret';
const MONITOR_ID = 'monitor-billdifferen';
const DEPLOY_HOOK = 'https://api.vercel.com/v1/integrations/deploy/example/secret';

const configuredEnv = {
  FIRECRAWL_WEBHOOK_SECRET: WEBHOOK_SECRET,
  FIRECRAWL_MONITOR_ID: MONITOR_ID,
  VERCEL_DEPLOY_HOOK: DEPLOY_HOOK,
};

interface FetchCall {
  input: string | URL | Request;
  init?: RequestInit;
}

function completedPayload(summary: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    success: true,
    type: 'monitor.check.completed',
    id: 'check-event',
    webhookId: 'webhook-event',
    data: [{
      monitorId: MONITOR_ID,
      checkId: 'check-result',
      status: 'completed',
      summary: {
        totalPages: 40,
        same: 40,
        changed: 0,
        new: 0,
        removed: 0,
        error: 0,
        ...summary,
      },
    }],
    metadata: {},
  };
}

function serialize(payload: unknown): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

function signature(body: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function signedRequest(
  payload: unknown,
  options: { signatureValue?: string | null; method?: string } = {},
): Request {
  const body = serialize(payload);
  const headers = new Headers({ 'content-type': 'application/json' });
  const signatureValue = options.signatureValue === undefined ? signature(body) : options.signatureValue;
  if (signatureValue !== null) headers.set('x-firecrawl-signature', signatureValue);
  return new Request('https://pilldiff.example/api/firecrawl', {
    method: options.method ?? 'POST',
    headers,
    body: options.method === 'GET' ? undefined : body,
  });
}

function fetchRecorder(response = new Response(null, { status: 200 })): {
  calls: FetchCall[];
  fetch: WebhookFetch;
} {
  const calls: FetchCall[] = [];
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ input, init });
      return response;
    },
  };
}

function dependencies(fetcher: WebhookFetch, overrides: Partial<FirecrawlWebhookDependencies> = {}): FirecrawlWebhookDependencies {
  return {
    env: configuredEnv,
    fetch: fetcher,
    ...overrides,
  };
}

for (const change of [
  { label: 'new page', summary: { same: 39, new: 1 } },
  { label: 'changed page', summary: { same: 39, changed: 1 } },
  { label: 'removed page', summary: { totalPages: 39, same: 39, removed: 1 } },
]) {
  test(`requests a deployment for a valid ${change.label} event`, async () => {
    const recorder = fetchRecorder();
    const response = await handleFirecrawlWebhook(
      signedRequest(completedPayload(change.summary)),
      dependencies(recorder.fetch),
    );

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: 'accepted', message: 'Deployment requested.' });
    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0].input, DEPLOY_HOOK);
    assert.equal(recorder.calls[0].init?.method, 'POST');
    assert.equal(recorder.calls[0].init?.redirect, 'error');
    assert.ok(recorder.calls[0].init?.signal instanceof AbortSignal);
  });
}

test('accepts Firecrawl data as a single object', async () => {
  const payload = completedPayload({ same: 39, changed: 1 });
  payload.data = (payload.data as unknown[])[0];
  const recorder = fetchRecorder();
  const response = await handleFirecrawlWebhook(signedRequest(payload), dependencies(recorder.fetch));
  assert.equal(response.status, 202);
  assert.equal(recorder.calls.length, 1);
});

test('ignores a completed check with no changes', async () => {
  const recorder = fetchRecorder();
  const response = await handleFirecrawlWebhook(signedRequest(completedPayload()), dependencies(recorder.fetch));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ignored' });
  assert.equal(recorder.calls.length, 0);
});

test('ignores unrelated event types and monitor IDs', async () => {
  const recorder = fetchRecorder();
  const pagePayload = completedPayload({ same: 39, changed: 1 });
  pagePayload.type = 'monitor.page';
  const pageResponse = await handleFirecrawlWebhook(signedRequest(pagePayload), dependencies(recorder.fetch));
  assert.equal(pageResponse.status, 200);

  const otherMonitorPayload = completedPayload({ same: 39, changed: 1 });
  const otherMonitorData = otherMonitorPayload.data as Array<Record<string, unknown>>;
  otherMonitorData[0].monitorId = 'monitor-somewhere-else';
  const otherMonitorResponse = await handleFirecrawlWebhook(
    signedRequest(otherMonitorPayload),
    dependencies(recorder.fetch),
  );
  assert.equal(otherMonitorResponse.status, 200);
  assert.equal(recorder.calls.length, 0);
});

for (const ignoredCase of [
  { label: 'unsuccessful check', mutate: (payload: Record<string, unknown>) => { payload.success = false; } },
  {
    label: 'partial check',
    mutate: (payload: Record<string, unknown>) => {
      const data = payload.data as Array<Record<string, unknown>>;
      data[0].status = 'partial';
    },
  },
  { label: 'check with page errors', mutate: (payload: Record<string, unknown>) => {
    const data = payload.data as Array<Record<string, unknown>>;
    const summary = data[0].summary as Record<string, unknown>;
    summary.error = 1;
  } },
]) {
  test(`ignores a ${ignoredCase.label}`, async () => {
    const payload = completedPayload({ same: 39, changed: 1 });
    ignoredCase.mutate(payload);
    const recorder = fetchRecorder();
    const response = await handleFirecrawlWebhook(signedRequest(payload), dependencies(recorder.fetch));
    assert.equal(response.status, 200);
    assert.equal(recorder.calls.length, 0);
  });
}

for (const invalidSignature of [
  { label: 'missing signature', value: null },
  { label: 'tampered signature', value: `sha256=${'0'.repeat(64)}` },
  { label: 'wrong algorithm', value: `sha1=${'0'.repeat(64)}` },
  { label: 'odd-length digest', value: `sha256=${'0'.repeat(63)}` },
  { label: 'non-hex digest', value: `sha256=${'g'.repeat(64)}` },
]) {
  test(`rejects a ${invalidSignature.label}`, async () => {
    const recorder = fetchRecorder();
    const response = await handleFirecrawlWebhook(
      signedRequest(completedPayload({ changed: 1 }), { signatureValue: invalidSignature.value }),
      dependencies(recorder.fetch),
    );
    assert.equal(response.status, 401);
    assert.equal(recorder.calls.length, 0);
  });
}

test('authenticates raw bytes before rejecting invalid JSON', async () => {
  const recorder = fetchRecorder();
  const response = await handleFirecrawlWebhook(
    signedRequest('{"incomplete":'),
    dependencies(recorder.fetch),
  );
  assert.equal(response.status, 400);
  assert.equal(recorder.calls.length, 0);
});

for (const invalidSummary of [
  { changed: '1' },
  { new: -1 },
  { removed: 0.5 },
  { error: null },
]) {
  test(`rejects invalid summary counts: ${JSON.stringify(invalidSummary)}`, async () => {
    const recorder = fetchRecorder();
    const response = await handleFirecrawlWebhook(
      signedRequest(completedPayload(invalidSummary)),
      dependencies(recorder.fetch),
    );
    assert.equal(response.status, 400);
    assert.equal(recorder.calls.length, 0);
  });
}

test('rejects webhook bodies larger than 64 KiB', async () => {
  const oversizedBody = JSON.stringify({ padding: 'x'.repeat(65 * 1024) });
  const recorder = fetchRecorder();
  const response = await handleFirecrawlWebhook(signedRequest(oversizedBody), dependencies(recorder.fetch));
  assert.equal(response.status, 413);
  assert.equal(recorder.calls.length, 0);
});

for (const missingVariable of [
  'FIRECRAWL_WEBHOOK_SECRET',
  'FIRECRAWL_MONITOR_ID',
  'VERCEL_DEPLOY_HOOK',
]) {
  test(`fails closed when ${missingVariable} is absent`, async () => {
    const env = { ...configuredEnv, [missingVariable]: undefined };
    const recorder = fetchRecorder();
    const response = await handleFirecrawlWebhook(
      signedRequest(completedPayload({ changed: 1 })),
      dependencies(recorder.fetch, { env }),
    );
    assert.equal(response.status, 503);
    assert.equal(recorder.calls.length, 0);
  });
}

test('fails closed when the deploy hook is not the Vercel HTTPS host', async () => {
  const recorder = fetchRecorder();
  const response = await handleFirecrawlWebhook(
    signedRequest(completedPayload({ changed: 1 })),
    dependencies(recorder.fetch, {
      env: { ...configuredEnv, VERCEL_DEPLOY_HOOK: 'https://example.com/collect' },
    }),
  );
  assert.equal(response.status, 503);
  assert.equal(recorder.calls.length, 0);
});

test('fails closed when the Vercel URL is not a deploy hook', async () => {
  const recorder = fetchRecorder();
  const response = await handleFirecrawlWebhook(
    signedRequest(completedPayload({ changed: 1 })),
    dependencies(recorder.fetch, {
      env: { ...configuredEnv, VERCEL_DEPLOY_HOOK: 'https://api.vercel.com/v1/projects/example' },
    }),
  );
  assert.equal(response.status, 503);
  assert.equal(recorder.calls.length, 0);
});

test('rejects non-POST requests and advertises POST', async () => {
  const recorder = fetchRecorder();
  const response = await handleFirecrawlWebhook(
    signedRequest('', { method: 'GET' }),
    dependencies(recorder.fetch),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.equal(recorder.calls.length, 0);
});

test('returns a safe error when Vercel rejects the deploy hook', async () => {
  const recorder = fetchRecorder(new Response('provider-secret-detail', { status: 429 }));
  const response = await handleFirecrawlWebhook(
    signedRequest(completedPayload({ same: 39, changed: 1 })),
    dependencies(recorder.fetch),
  );
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.doesNotMatch(body, /provider-secret-detail|firecrawl-signing-secret|integrations\/deploy/);
});

test('returns a safe error when the deploy request throws', async () => {
  const fetcher: WebhookFetch = async () => {
    throw new Error('network detail containing a credential');
  };
  const response = await handleFirecrawlWebhook(
    signedRequest(completedPayload({ same: 39, changed: 1 })),
    dependencies(fetcher),
  );
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /credential|network detail/);
});

test('bounds the deploy request with an abort signal', async () => {
  const fetcher: WebhookFetch = async (_input, init) => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    assert.ok(signal);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const response = await handleFirecrawlWebhook(
    signedRequest(completedPayload({ same: 39, changed: 1 })),
    dependencies(fetcher, { deployTimeoutMs: 5 }),
  );
  assert.equal(response.status, 502);
});
