import { ProviderError } from "./contract.js";

const TERMINAL = new Set(["failed", "expired", "canceled"]);

function fail(code, message, httpStatus = 500, extra = {}) {
  throw new ProviderError(code, message, { httpStatus, ...extra });
}

function baseUrl(env) {
  if (!env.COMFYUI_BASE_URL) fail("PROVIDER_CONFIG", "ComfyUI base URL is not configured.", 503);
  let url;
  try { url = new URL(env.COMFYUI_BASE_URL); } catch { fail("PROVIDER_CONFIG", "ComfyUI base URL is invalid.", 503); }
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(env.LOCAL_DEV === "true" && local))
    fail("PROVIDER_CONFIG", "ComfyUI must use HTTPS; local HTTP is allowed only in LOCAL_DEV.", 503);
  return url;
}

function headers(env, json = false) {
  const h = new Headers({ accept: "application/json" });
  if (env.COMFYUI_API_KEY) h.set("authorization", `Bearer ${env.COMFYUI_API_KEY}`);
  if (json) h.set("content-type", "application/json");
  return h;
}

async function request(env, fetchImpl, path, init = {}, { submission = false } = {}) {
  const base = baseUrl(env);
  const target = new URL(path, base);
  if (target.origin !== base.origin) fail("UNSAFE_PROVIDER_URL", "ComfyUI request escaped configured origin.", 500);
  try {
    const res = await fetchImpl(target, { ...init, redirect: "manual", signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      const payload = await res.clone().json().catch(() => null);
      throw new ProviderError("COMFY_HTTP", payload?.message || `ComfyUI returned HTTP ${res.status}.`, {
        httpStatus: res.status === 401 || res.status === 403 ? 503 : 502,
        retryable: res.status === 429 || res.status >= 500,
        uncertain: Boolean(submission && res.status >= 500),
      });
    }
    return res;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("COMFY_TRANSPORT", submission ? "ComfyUI submission outcome is unknown; reconcile before retrying." : "ComfyUI could not be reached safely.", {
      httpStatus: 502,
      retryable: true,
      uncertain: Boolean(submission),
    });
  }
}

async function loadWorkflow(env) {
  if (env.COMFYUI_CHARACTER_WORKFLOW_JSON) {
    try { return JSON.parse(env.COMFYUI_CHARACTER_WORKFLOW_JSON); }
    catch { fail("PROVIDER_CONFIG", "COMFYUI_CHARACTER_WORKFLOW_JSON is invalid JSON.", 503); }
  }
  if (!env.GENERATION_MEDIA) fail("PROVIDER_CONFIG", "Generation media storage is required.", 503);
  const key = env.COMFYUI_CHARACTER_WORKFLOW_KEY || "comfy/workflows/character-still.json";
  const obj = await env.GENERATION_MEDIA.get(key);
  if (!obj) fail("PROVIDER_CONFIG", `Character still workflow missing at ${key}.`, 503);
  return obj.json();
}

function inject(value, replacements) {
  if (Array.isArray(value)) return value.map((v) => inject(v, replacements));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, inject(v, replacements)]));
  if (typeof value !== "string") return value;
  return Object.hasOwn(replacements, value) ? replacements[value] : value.replaceAll("__FPAI_PROMPT__", replacements.__FPAI_PROMPT__);
}

function apiWorkflow(workflow) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) fail("PROVIDER_CONFIG", "Character workflow must be API-format JSON.", 503);
  if (Array.isArray(workflow.nodes) || Array.isArray(workflow.links)) fail("PROVIDER_CONFIG", "UI-format Comfy workflow is not accepted.", 503);
  return workflow;
}

function normalizeRate(env) {
  const n = Number(env.COMFYUI_CHARACTER_COST_PER_IMAGE_USD ?? 0);
  if (!Number.isFinite(n) || n < 0) fail("PROVIDER_CONFIG", "COMFYUI_CHARACTER_COST_PER_IMAGE_USD must be non-negative.", 503);
  return n;
}

export function createComfyCharacterExecutor(env = {}, fetchImpl = fetch) {
  return {
    capabilities: {
      id: "comfy-character-still",
      label: "ComfyUI · Character Still",
      output: "image",
      mimeTypes: ["image/png", "image/jpeg"],
      paid: normalizeRate(env) > 0,
      model: env.COMFYUI_CHARACTER_WORKFLOW_NAME || "fpai-character-still-v1",
    },
    estimate() {
      return { estimatedCost: normalizeRate(env), currency: "USD", priceBasis: "operator-configured-per-image-rate" };
    },
    async start({ prompt, width = 1024, height = 1024, seed = -1, filenamePrefix = "fpai-character" }) {
      if (!prompt?.trim()) fail("INVALID_INPUT", "Character prompt is required.", 400);
      const workflow = inject(apiWorkflow(await loadWorkflow(env)), {
        __FPAI_PROMPT__: prompt,
        __FPAI_WIDTH__: Number(width),
        __FPAI_HEIGHT__: Number(height),
        __FPAI_SEED__: Number(seed),
        __FPAI_FILENAME_PREFIX__: filenamePrefix,
      });
      const h = headers(env, true);
      h.set("idempotency-key", crypto.randomUUID());
      const res = await request(env, fetchImpl, "/api/v2/jobs", { method: "POST", headers: h, body: JSON.stringify({ workflow }) }, { submission: true });
      const job = await res.json();
      if (!job?.id) fail("INVALID_OPERATION", "ComfyUI did not return a job ID; reconcile before retrying.", 502, { uncertain: true });
      return { operationId: job.id };
    },
    async status(operationId) {
      const res = await request(env, fetchImpl, `/api/v2/jobs/${encodeURIComponent(operationId)}`, { headers: headers(env) });
      const job = await res.json();
      if (["queued", "running", "canceling"].includes(job.status)) return { status: "running" };
      if (TERMINAL.has(job.status)) return { status: "failed", error: job.error || { code: "COMFY_JOB_FAILED", message: `Character job ended as ${job.status}.` } };
      if (job.status !== "succeeded") fail("INVALID_STATUS", "ComfyUI returned an unknown character job status.", 502);
      const output = (job.outputs || []).find((o) => o.type === "image" || o.content_type?.startsWith("image/"));
      if (!output?.id) return { status: "failed", error: { code: "NO_IMAGE_OUTPUT", message: "Character workflow completed without an image output." } };
      return { status: "completed", asset: { id: output.id, contentType: output.content_type || "image/png" } };
    },
    async asset(assetId) {
      const res = await request(env, fetchImpl, `/api/v2/assets/${encodeURIComponent(assetId)}/content`, { headers: headers(env) });
      return res;
    },
    async cancel(operationId) {
      await request(env, fetchImpl, `/api/v2/jobs/${encodeURIComponent(operationId)}/cancel`, { method: "POST", headers: headers(env) });
      return { status: "canceled" };
    },
  };
}
