import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_DEPLOY_TIMEOUT_MS = 10_000;
const COMPLETED_EVENT = 'monitor.check.completed';

export type WebhookFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface FirecrawlWebhookDependencies {
  env: Record<string, string | undefined>;
  fetch: WebhookFetch;
  deployTimeoutMs?: number;
}

interface WebhookConfig {
  secret: string;
  monitorId: string;
  deployHook: URL;
}

interface CheckSummary {
  totalPages: number;
  same: number;
  changed: number;
  new: number;
  removed: number;
  error: number;
}

interface CheckResult {
  monitorId: string;
  checkId: string;
  status: string;
  summary?: CheckSummary;
}

function jsonResponse(status: number, payload: object, headers?: HeadersInit): Response {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function loadConfig(env: Record<string, string | undefined>): WebhookConfig | null {
  const secret = env.FIRECRAWL_WEBHOOK_SECRET;
  const monitorId = env.FIRECRAWL_MONITOR_ID;
  const deployHookValue = env.VERCEL_DEPLOY_HOOK;
  if (!secret || !monitorId || !deployHookValue) return null;

  try {
    const deployHook = new URL(deployHookValue);
    const hasDeployHookPath = /^\/v1\/integrations\/deploy\/[^/]+\/[^/]+\/?$/.test(deployHook.pathname);
    if (
      deployHook.protocol !== 'https:'
      || deployHook.host !== 'api.vercel.com'
      || !hasDeployHookPath
      || deployHook.username
      || deployHook.password
      || deployHook.hash
    ) {
      return null;
    }
    return { secret, monitorId, deployHook };
  } catch {
    return null;
  }
}

function signatureDigest(signature: string | null): Buffer | null {
  const match = signature?.match(/^sha256=([0-9a-fA-F]{64})$/);
  return match ? Buffer.from(match[1], 'hex') : null;
}

function hasValidSignature(body: Uint8Array, secret: string, signature: string | null): boolean {
  const receivedDigest = signatureDigest(signature);
  if (!receivedDigest) return false;
  const expectedDigest = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) {
    return null;
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    totalBytes += result.value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(result.value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseSummary(value: unknown): CheckSummary | null {
  if (!isRecord(value)) return null;
  const fields = ['totalPages', 'same', 'changed', 'new', 'removed', 'error'] as const;
  if (!fields.every((field) => isCount(value[field]))) return null;
  return {
    totalPages: value.totalPages as number,
    same: value.same as number,
    changed: value.changed as number,
    new: value.new as number,
    removed: value.removed as number,
    error: value.error as number,
  };
}

function parseCheckResult(value: unknown): CheckResult | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.monitorId !== 'string'
    || typeof value.checkId !== 'string'
    || typeof value.status !== 'string'
  ) {
    return null;
  }

  if (value.status !== 'completed') {
    return {
      monitorId: value.monitorId,
      checkId: value.checkId,
      status: value.status,
    };
  }

  const summary = parseSummary(value.summary);
  if (!summary) return null;
  return {
    monitorId: value.monitorId,
    checkId: value.checkId,
    status: value.status,
    summary,
  };
}

function parseCheckResults(value: unknown): CheckResult[] | null {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) return null;
  const results = values.map(parseCheckResult);
  return results.every((result): result is CheckResult => result !== null) ? results : null;
}

function hasDeployableChange(result: CheckResult, monitorId: string): boolean {
  if (result.monitorId !== monitorId || result.status !== 'completed' || !result.summary) return false;
  if (result.summary.error !== 0) return false;
  return result.summary.new + result.summary.changed + result.summary.removed > 0;
}

export async function handleFirecrawlWebhook(
  request: Request,
  dependencies: FirecrawlWebhookDependencies,
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' }, { allow: 'POST' });
  }

  const config = loadConfig(dependencies.env);
  if (!config) {
    return jsonResponse(503, { error: 'Webhook unavailable.' });
  }

  const signature = request.headers.get('x-firecrawl-signature');
  if (!signatureDigest(signature)) {
    return jsonResponse(401, { error: 'Invalid signature.' });
  }

  let body: Uint8Array | null;
  try {
    body = await readBoundedBody(request);
  } catch {
    return jsonResponse(400, { error: 'Invalid webhook request.' });
  }
  if (!body) {
    return jsonResponse(413, { error: 'Webhook payload too large.' });
  }
  if (!hasValidSignature(body, config.secret, signature)) {
    return jsonResponse(401, { error: 'Invalid signature.' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return jsonResponse(400, { error: 'Invalid webhook payload.' });
  }

  if (!isRecord(payload)) {
    return jsonResponse(400, { error: 'Invalid webhook payload.' });
  }
  if (payload.type !== COMPLETED_EVENT) {
    return jsonResponse(200, { status: 'ignored' });
  }
  if (payload.success === false) {
    return jsonResponse(200, { status: 'ignored' });
  }
  if (payload.success !== true) {
    return jsonResponse(400, { error: 'Invalid webhook payload.' });
  }

  const results = parseCheckResults(payload.data);
  if (!results) {
    return jsonResponse(400, { error: 'Invalid webhook payload.' });
  }
  if (!results.some((result) => hasDeployableChange(result, config.monitorId))) {
    return jsonResponse(200, { status: 'ignored' });
  }

  const deployTimeoutMs = dependencies.deployTimeoutMs ?? DEFAULT_DEPLOY_TIMEOUT_MS;
  try {
    const deployResponse = await dependencies.fetch(config.deployHook.href, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(deployTimeoutMs),
    });
    if (!deployResponse.ok) {
      return jsonResponse(502, { error: 'Deployment request failed.' });
    }
  } catch {
    return jsonResponse(502, { error: 'Deployment request failed.' });
  }

  return jsonResponse(202, { status: 'accepted', message: 'Deployment requested.' });
}
