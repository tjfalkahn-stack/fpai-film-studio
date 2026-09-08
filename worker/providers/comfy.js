import { ProviderError, fail } from "./contract.js";

const DEFAULT_WORKFLOW_KEY = "comfy/workflows/video.json";
const DEFAULT_MODEL = "comfyui-api-workflow-v2";
const TERMINAL_FAILURES = new Set(["failed", "expired", "canceled"]);

function baseUrl(env) {
  if (!env.COMFYUI_BASE_URL)
    fail("PROVIDER_CONFIG", "ComfyUI base URL is not configured.", 503);
  let url;
  try {
    url = new URL(env.COMFYUI_BASE_URL);
  } catch {
    fail("PROVIDER_CONFIG", "ComfyUI base URL is invalid.", 503);
  }
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(env.LOCAL_DEV === "true" && local))
    fail(
      "PROVIDER_CONFIG",
      "ComfyUI must use HTTPS; local HTTP is allowed only in LOCAL_DEV.",
      503,
    );
  if (url.username || url.password || url.search || url.hash)
    fail("PROVIDER_CONFIG", "ComfyUI base URL must not contain credentials, query, or fragment.", 503);
  return url;
}

function enabled(env) {
  if (
    env.LIVE_RENDERING_ENABLED !== "true" ||
    env.MOCK_E2E_VERIFIED !== "true"
  )
    fail("LIVE_DISABLED", "Live rendering is disabled.", 403);
  return baseUrl(env);
}

function authHeaders(env, json = false) {
  const headers = new Headers();
  if (env.COMFYUI_API_KEY)
    headers.set("authorization", `Bearer ${env.COMFYUI_API_KEY}`);
  if (json) headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  return headers;
}

async function parseError(response) {
  const payload = await response.clone().json().catch(() => null);
  return (
    payload?.error?.message ||
    payload?.message ||
    payload?.error?.code ||
    `ComfyUI returned HTTP ${response.status}.`
  );
}

function providerError(response, message, uncertain = false) {
  return new ProviderError("COMFY_HTTP", message, {
    httpStatus: response.status === 401 || response.status === 403 ? 503 : 502,
    retryable: response.status === 429 || response.status >= 500,
    uncertain,
  });
}

async function comfyFetch(env, fetchImpl, path, init = {}, options = {}) {
  const base = enabled(env);
  const target = new URL(path, base);
  if (target.origin !== base.origin)
    fail("UNSAFE_PROVIDER_URL", "ComfyUI request escaped the configured origin.", 500);
  try {
    const response = await fetchImpl(target, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeout || 30000),
    });
    const allowedRedirect = options.allowRedirect === true && response.status === 302;
    if (!response.ok && !allowedRedirect) {
      const message = await parseError(response);
      throw providerError(
        response,
        message,
        Boolean(options.submission && response.status >= 500),
      );
    }
    return response;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      "COMFY_TRANSPORT",
      options.submission
        ? "ComfyUI submission outcome is unknown; do not resubmit this render."
        : "ComfyUI could not be reached safely.",
      {
        httpStatus: 502,
        retryable: true,
        uncertain: Boolean(options.submission),
      },
    );
  }
}

function decodeBase64(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function uploadReference(env, fetchImpl, ref, index) {
  const extension = ref.mimeType === "image/png" ? "png" : "jpg";
  const filePath = `input/fpai/reference-${crypto.randomUUID()}-${index + 1}.${extension}`;
  const form = new FormData();
  form.append(
    "file",
    new Blob([decodeBase64(ref.data)], { type: ref.mimeType }),
    filePath.split("/").at(-1),
  );
  form.append("content_type", ref.mimeType);
  form.append("file_path", filePath);
  const headers = authHeaders(env);
  headers.set("idempotency-key", crypto.randomUUID());
  const response = await comfyFetch(
    env,
    fetchImpl,
    "/api/v2/assets",
    { method: "POST", headers, body: form },
  );
  const asset = await response.json();
  if (!asset?.id)
    throw new ProviderError("INVALID_ASSET", "ComfyUI did not return an asset ID.", {
      httpStatus: 502,
    });
  return {
    __type: "core/ASSET",
    info: {
      id: asset.id,
      hash: asset.hash ?? null,
      file_path: asset.file_path || filePath,
    },
  };
}

async function loadWorkflow(env) {
  if (env.COMFYUI_WORKFLOW_JSON) {
    try {
      return JSON.parse(env.COMFYUI_WORKFLOW_JSON);
    } catch {
      fail("PROVIDER_CONFIG", "COMFYUI_WORKFLOW_JSON is not valid JSON.", 503);
    }
  }
  if (!env.GENERATION_MEDIA)
    fail("PROVIDER_CONFIG", "Render media storage is required for the ComfyUI workflow.", 503);
  const key = env.COMFYUI_WORKFLOW_KEY || DEFAULT_WORKFLOW_KEY;
  const object = await env.GENERATION_MEDIA.get(key);
  if (!object)
    fail(
      "PROVIDER_CONFIG",
      `ComfyUI API workflow is missing from private R2 at ${key}.`,
      503,
    );
  try {
    return await object.json();
  } catch {
    fail("PROVIDER_CONFIG", "Stored ComfyUI workflow is not valid JSON.", 503);
  }
}

function dimensions(resolution, aspectRatio) {
  const landscape = resolution === "1080p" ? [1920, 1080] : [1280, 720];
  return aspectRatio === "9:16" ? landscape.toReversed() : landscape;
}

function inject(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => inject(item, replacements));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, inject(item, replacements)]),
    );
  if (typeof value !== "string") return value;
  if (Object.hasOwn(replacements, value)) return replacements[value];
  return value
    .replaceAll("__FPAI_PROMPT__", String(replacements.__FPAI_PROMPT__))
    .replaceAll("__FPAI_ASPECT_RATIO__", String(replacements.__FPAI_ASPECT_RATIO__));
}

function apiWorkflow(workflow) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow))
    fail("PROVIDER_CONFIG", "ComfyUI workflow must be an API-format JSON object.", 503);
  if (Array.isArray(workflow.nodes) || Array.isArray(workflow.links))
    fail(
      "PROVIDER_CONFIG",
      "ComfyUI UI-format JSON is not accepted. Export the workflow in API format.",
      503,
    );
  return workflow;
}

function rate(env) {
  const value = Number(env.COMFYUI_COST_PER_SECOND_USD ?? 0);
  if (!Number.isFinite(value) || value < 0)
    fail("PROVIDER_CONFIG", "COMFYUI_COST_PER_SECOND_USD must be non-negative.", 503);
  return value;
}

function terminalCost(job) {
  return Number(job.estimated_cost || 0);
}

export function createComfyProvider(env = {}, fetchImpl = fetch) {
  return {
    capabilities: {
      id: "comfy-video",
      label: "ComfyUI · Workflow",
      paid: true,
      ledgerRoutes: {
        "720p": "comfy-video-720",
        "1080p": "comfy-video-1080",
      },
      model: env.COMFYUI_WORKFLOW_NAME || DEFAULT_MODEL,
      durations: [4, 6, 8],
      resolutions: ["720p", "1080p"],
      aspectRatios: ["16:9", "9:16"],
      maxReferences: 3,
      cancelRunning: true,
    },
    estimate(input) {
      const estimatedCost = Math.round(input.duration * rate(env) * 10000) / 10000;
      return {
        estimatedCost,
        currency: "USD",
        priceBasis: "operator-configured-comfy-infrastructure-rate",
      };
    },
    async start(input) {
      enabled(env);
      const references = await Promise.all(
        input.referenceImages.map((ref, index) => uploadReference(env, fetchImpl, ref, index)),
      );
      const [width, height] = dimensions(input.resolution, input.aspectRatio);
      const replacements = {
        __FPAI_PROMPT__: input.prompt,
        __FPAI_DURATION__: input.duration,
        __FPAI_ASPECT_RATIO__: input.aspectRatio,
        __FPAI_WIDTH__: width,
        __FPAI_HEIGHT__: height,
      };
      references.forEach((reference, index) => {
        replacements[`__FPAI_REFERENCE_${index + 1}__`] = reference;
      });
      const workflow = inject(apiWorkflow(await loadWorkflow(env)), replacements);
      const headers = authHeaders(env, true);
      headers.set("idempotency-key", crypto.randomUUID());
      const response = await comfyFetch(
        env,
        fetchImpl,
        "/api/v2/jobs",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ workflow }),
        },
        { submission: true },
      );
      const job = await response.json();
      if (!job?.id)
        throw new ProviderError(
          "INVALID_OPERATION",
          "ComfyUI did not return a job ID; reconcile before retrying.",
          { httpStatus: 502, uncertain: true },
        );
      return { operationId: job.id };
    },
    async status(job) {
      if (!job.operation_id)
        fail("INVALID_OPERATION", "Stored ComfyUI job ID is missing.");
      const response = await comfyFetch(
        env,
        fetchImpl,
        `/api/v2/jobs/${encodeURIComponent(job.operation_id)}`,
        { headers: authHeaders(env) },
      );
      const current = await response.json();
      if (["queued", "running", "canceling"].includes(current.status))
        return { status: "running" };
      if (TERMINAL_FAILURES.has(current.status))
        return {
          status: "failed",
          actualCost: terminalCost(job),
          costBasis: "comfy-terminal-usage-at-configured-rate",
          error: {
            code: current.error?.code || "COMFY_JOB_FAILED",
            message: current.error?.message || `ComfyUI job ended as ${current.status}.`,
            retryable: false,
          },
        };
      if (current.status !== "succeeded")
        throw new ProviderError("INVALID_STATUS", "ComfyUI returned an unknown job status.", {
          httpStatus: 502,
        });
      const output = (current.outputs || []).find(
        (item) => item.type === "video" || item.content_type?.startsWith("video/"),
      );
      if (!output?.id)
        return {
          status: "failed",
          actualCost: terminalCost(job),
          costBasis: "comfy-completed-no-video-at-configured-rate",
          error: {
            code: "NO_VIDEO_OUTPUT",
            message: "ComfyUI workflow completed without a video output.",
            retryable: false,
          },
        };
      if (output.content_type !== "video/mp4")
        return {
          status: "failed",
          actualCost: terminalCost(job),
          costBasis: "comfy-completed-unsupported-output-at-configured-rate",
          error: {
            code: "UNSUPPORTED_OUTPUT",
            message: "Film Studio currently requires the ComfyUI workflow to output video/mp4.",
            retryable: false,
          },
        };
      return {
        status: "completed",
        actualCost: terminalCost(job),
        costBasis: "comfy-completed-at-configured-rate",
        asset: { id: output.id, contentType: output.content_type },
      };
    },
    async cancel(job) {
      if (!job.operation_id)
        fail("INVALID_OPERATION", "Stored ComfyUI job ID is missing.");
      const response = await comfyFetch(
        env,
        fetchImpl,
        `/api/v2/jobs/${encodeURIComponent(job.operation_id)}/cancel`,
        { method: "POST", headers: authHeaders(env) },
      );
      await response.json().catch(() => null);
      return {
        status: "canceled",
        actualCost: terminalCost(job),
        costBasis: "comfy-canceled-at-configured-rate",
      };
    },
    async asset(job) {
      const asset = JSON.parse(job.asset_json || "null");
      if (!asset?.id)
        fail("INVALID_ASSET", "Stored ComfyUI output asset is invalid.", 502);
      let response = await comfyFetch(
        env,
        fetchImpl,
        `/api/v2/assets/${encodeURIComponent(asset.id)}/content`,
        { headers: authHeaders(env) },
        { allowRedirect: true },
      );
      if (response.status === 302) {
        const location = response.headers.get("location");
        if (!location) fail("INVALID_ASSET", "ComfyUI asset redirect is missing a location.", 502);
        const target = new URL(location);
        if (target.protocol !== "https:")
          fail("UNSAFE_ASSET_URL", "ComfyUI returned an unsafe asset redirect.", 502);
        response = await fetchImpl(target, {
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
      }
      if (!response.ok)
        fail("ASSET_RETRY", "ComfyUI video exists but download failed. Retry status; do not regenerate.", 502);
      return response;
    },
  };
}
