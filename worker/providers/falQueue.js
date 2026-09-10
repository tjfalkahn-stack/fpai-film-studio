import { ProviderError, fail } from "./contract.js";
import {
  SEEDANCE_QUEUE_ORIGIN,
  SEEDANCE_ENDPOINT_IDS,
} from "../../src/seedanceRequest.js";

const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;
const ENDPOINT_SET = new Set(SEEDANCE_ENDPOINT_IDS);

export function falAuthHeader(env) {
  const raw = String(env?.FAL_KEY || "").trim();
  const key = raw.replace(/^key\s+/i, "");
  if (!key) fail("PROVIDER_CONFIG", "FAL_KEY is not configured.", 503);
  return `Key ${key}`;
}

export function encodeFalOperationId(endpointId, requestId) {
  return `fal:${endpointId}:${requestId}`;
}

export function parseFalOperationId(operationId) {
  const value = String(operationId || "");
  if (!value.startsWith("fal:")) fail("INVALID_OPERATION", "Stored Seedance operation is invalid.");
  const rest = value.slice(4);
  const split = rest.lastIndexOf(":");
  if (split <= 0) fail("INVALID_OPERATION", "Stored Seedance operation is invalid.");
  const endpointId = rest.slice(0, split);
  const requestId = rest.slice(split + 1);
  if (!ENDPOINT_SET.has(endpointId) || !REQUEST_ID.test(requestId)) {
    fail("INVALID_OPERATION", "Stored Seedance operation is invalid.");
  }
  return { endpointId, requestId };
}

export function falRequestUrl(endpointId, requestId, kind = "result") {
  const base = `${SEEDANCE_QUEUE_ORIGIN}/${endpointId}/requests/${encodeURIComponent(requestId)}`;
  if (kind === "status") return `${base}/status`;
  if (kind === "cancel") return `${base}/cancel`;
  return base;
}

function webhookQuery(env) {
  const url = String(env.SEEDANCE_WEBHOOK_URL || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") fail("PROVIDER_CONFIG", "SEEDANCE_WEBHOOK_URL must be https.", 503);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    fail("PROVIDER_CONFIG", "SEEDANCE_WEBHOOK_URL is not a valid URL.", 503);
  }
  return `?fal_webhook=${encodeURIComponent(url)}`;
}

export function falSubmitUrl(endpointId, env) {
  return `${SEEDANCE_QUEUE_ORIGIN}/${endpointId}${webhookQuery(env)}`;
}

export async function falQueueRequest(env, fetchImpl, options = {}) {
  const { method = "GET", endpointId, requestId, kind = "result", body } = options;
  const target =
    kind === "submit"
      ? falSubmitUrl(endpointId, env)
      : falRequestUrl(endpointId, requestId, kind);
  const init = {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      authorization: falAuthHeader(env),
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  try {
    const response = await fetchImpl(target, init);
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      throw new ProviderError(
        "PROVIDER_HTTP",
        `fal.ai returned HTTP ${response.status}.`,
        {
          httpStatus: 502,
          retryable: response.status === 429 || response.status >= 500,
          uncertain: method === "POST" && response.status >= 500,
        },
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      "PROVIDER_TRANSPORT",
      "fal.ai response was not received safely; do not resubmit.",
      { httpStatus: 502, retryable: true, uncertain: method === "POST" },
    );
  }
}

const ALLOWED_ASSET_HOSTS = [
  /(^|\.)fal\.media$/i,
  /(^|\.)fal\.run$/i,
  /(^|\.)googleusercontent\.com$/i,
];

export function assertSafeFalAssetUrl(raw) {
  let uri;
  try {
    uri = new URL(raw);
  } catch {
    fail("UNSAFE_ASSET_URL", "fal.ai returned an unexpected asset location.", 502);
  }
  if (uri.protocol !== "https:") fail("UNSAFE_ASSET_URL", "fal.ai returned an unexpected asset location.", 502);
  const host = uri.hostname;
  const allowedHost = ALLOWED_ASSET_HOSTS.some((pattern) => pattern.test(host));
  const allowedBucket =
    host === "storage.googleapis.com" && /fal/i.test(`${uri.pathname}${uri.search}`);
  if (!allowedHost && !allowedBucket) {
    fail("UNSAFE_ASSET_URL", "fal.ai returned an unexpected asset location.", 502);
  }
  return uri;
}

export async function downloadFalAsset(fetchImpl, rawUrl) {
  const uri = assertSafeFalAssetUrl(rawUrl);
  const response = await fetchImpl(uri, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    fail(
      "ASSET_RETRY",
      "Video was generated but download failed. Retry status; no regeneration is needed.",
      502,
    );
  }
  return response;
}
