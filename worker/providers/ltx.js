import { ProviderError, fail } from "./contract.js";

const API_ORIGIN = "https://api.ltx.video";
const TIERS = {
  fast: {
    id: "ltx-2.5-fast",
    label: "LTX 2.5 Fast (API)",
    model: "ltx-2-5-fast",
    rateKey: "LTX_FAST_RATE_PER_SECOND_USD",
  },
  pro: {
    id: "ltx-2.5-pro",
    label: "LTX 2.5 Pro (API)",
    model: "ltx-2-5-pro",
    rateKey: "LTX_PRO_RATE_PER_SECOND_USD",
  },
};

export const isLtxProvider = (id) =>
  id === TIERS.fast.id || id === TIERS.pro.id;

export const ltxLiveEnabled = (env = {}) => env.LTX_LIVE_ENABLED === "true";

function metaFor(tier) {
  const meta = TIERS[tier];
  if (!meta) fail("PROVIDER_CONFIG", "Unknown LTX tier.", 503);
  return meta;
}

function apiBase(env) {
  const value = String(env.LTX_API_BASE_URL || API_ORIGIN).replace(/\/$/, "");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("PROVIDER_CONFIG", "LTX_API_BASE_URL is invalid.", 503);
  }
  if (url.protocol !== "https:")
    fail("PROVIDER_CONFIG", "LTX_API_BASE_URL must use HTTPS.", 503);
  return url.origin;
}

function rateFor(env, meta) {
  const rate = Number(env[meta.rateKey]);
  if (!Number.isFinite(rate) || rate <= 0)
    fail(
      "PROVIDER_CONFIG",
      `${meta.rateKey} must be set to the current LTX console rate before quoting or submitting.`,
      503,
    );
  return rate;
}

function requireLive(env) {
  if (!ltxLiveEnabled(env))
    fail("LIVE_DISABLED", "LTX live rendering is disabled.", 403);
  if (!String(env.LTX_API_KEY || "").trim())
    fail("PROVIDER_CONFIG", "LTX_API_KEY is not configured.", 503);
}

function auth(env) {
  return { authorization: `Bearer ${String(env.LTX_API_KEY).trim()}` };
}

async function providerError(response, stage) {
  const detail = (await response.text().catch(() => "")).slice(0, 500);
  throw new ProviderError(
    "LTX_API_ERROR",
    `LTX ${stage} failed (${response.status})${detail ? `: ${detail}` : "."}`,
    { httpStatus: 502, retryable: response.status >= 500 },
  );
}

async function uploadReference(env, fetchImpl, ref) {
  const init = await fetchImpl(`${apiBase(env)}/v1/upload`, {
    method: "POST",
    headers: auth(env),
  });
  if (!init.ok) await providerError(init, "upload initialization");
  const payload = await init.json().catch(() => null);
  if (
    !payload ||
    typeof payload.upload_url !== "string" ||
    typeof payload.storage_uri !== "string"
  )
    throw new ProviderError(
      "LTX_INVALID_RESPONSE",
      "LTX returned an invalid signed-upload response.",
      { httpStatus: 502 },
    );
  const bytes = Uint8Array.from(atob(ref.data), (value) => value.charCodeAt(0));
  const uploaded = await fetchImpl(payload.upload_url, {
    method: "PUT",
    headers: {
      "content-type": ref.mimeType,
      ...(payload.required_headers || {}),
    },
    body: bytes,
  });
  if (!uploaded.ok) await providerError(uploaded, "reference upload");
  return payload.storage_uri;
}

function safeDownloadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("LTX_INVALID_RESPONSE", "LTX returned an invalid video URL.", 502);
  }
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname))
    fail("LTX_INVALID_RESPONSE", "LTX returned an unsafe video URL.", 502);
  return url.toString();
}

async function videoResponse(env, fetchImpl, response) {
  if (!response.ok) await providerError(response, "generation");
  if ((response.headers.get("content-type") || "").includes("video/")) return response;
  const payload = await response.json().catch(() => null);
  const url = payload?.video_url || payload?.output_video || payload?.result?.video_url;
  if (!url)
    fail("LTX_NO_OUTPUT", "LTX completed without returning a video.", 502);
  const downloaded = await fetchImpl(safeDownloadUrl(url), { method: "GET" });
  if (!downloaded.ok) await providerError(downloaded, "video download");
  return downloaded;
}

function capabilities(meta, tier) {
  return {
    id: meta.id,
    label: meta.label,
    paid: true,
    ledgerRoutes: { "720p": meta.id, "1080p": meta.id },
    model: meta.model,
    durations: [4, 6, 8],
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16"],
    maxReferences: 1,
    cancelRunning: false,
    audio: true,
    generateAudio: true,
    referenceImages: true,
    providerFamily: "ltx",
    tier,
    uiHint:
      "LTX 2.5 API generation. One selected image becomes the opening frame; use a composed approved still for multi-character continuity.",
  };
}

export function createLtxProvider(env = {}, fetchImpl = fetch, options = {}) {
  const tier = options.tier === "pro" ? "pro" : "fast";
  const meta = metaFor(tier);
  return {
    capabilities: capabilities(meta, tier),
    estimate(input) {
      const ratePerSecond = rateFor(env, meta);
      return {
        estimatedCost: Number((ratePerSecond * input.duration).toFixed(4)),
        currency: "USD",
        priceBasis: env.LTX_PRICE_BASIS || "operator-configured-ltx-console-rate",
        ratePerSecond,
      };
    },
    async start(input) {
      requireLive(env);
      const references = input.referenceImages || [];
      const imageUri = references[0]
        ? await uploadReference(env, fetchImpl, references[0])
        : null;
      const endpoint = imageUri ? "/v1/image-to-video" : "/v1/text-to-video";
      const body = {
        prompt: input.prompt,
        model: meta.model,
        resolution: input.resolution === "1080p" ? "1920x1080" : "1280x720",
        duration: input.duration,
        fps: 24,
        generate_audio: input.generateAudio !== false,
        ...(imageUri ? { image_uri: imageUri } : {}),
      };
      let response;
      try {
        response = await fetchImpl(`${apiBase(env)}${endpoint}`, {
          method: "POST",
          headers: { ...auth(env), "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        throw new ProviderError(
          "LTX_SUBMISSION_UNKNOWN",
          "The LTX request outcome is unknown. Reconcile provider usage before retrying.",
          { uncertain: true, retryable: false, httpStatus: 502 },
        );
      }
      return {
        operationId: `ltx-sync:${crypto.randomUUID()}`,
        completedResponse: await videoResponse(env, fetchImpl, response),
        costBasis: "completed-usage-at-quoted-operator-rate",
      };
    },
    async status() {
      fail("LTX_SYNC_ONLY", "LTX synchronous generations do not expose a pollable job.", 409);
    },
    async cancel() {
      fail("CANCEL_UNSUPPORTED", "LTX cannot be canceled after submission begins.", 409);
    },
    async asset() {
      fail("LTX_ASSET_STORED", "LTX output is stored directly when generation completes.", 409);
    },
  };
}

export const createLtxFastProvider = (env, fetchImpl) =>
  createLtxProvider(env, fetchImpl, { tier: "fast" });
export const createLtxProProvider = (env, fetchImpl) =>
  createLtxProvider(env, fetchImpl, { tier: "pro" });
