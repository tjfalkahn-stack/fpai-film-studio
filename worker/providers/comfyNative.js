import { ProviderError, fail } from "./contract.js";

const DEFAULT_TIMEOUT_MS = 30000;

export function comfyBaseUrl(env) {
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

export function requireLiveRendering(env) {
  if (env.LIVE_RENDERING_ENABLED !== "true" || env.MOCK_E2E_VERIFIED !== "true")
    fail("LIVE_DISABLED", "Live rendering is disabled.", 403);
  return comfyBaseUrl(env);
}

export function comfyClientId(env) {
  const configured = String(env.COMFYUI_CLIENT_ID || "").trim();
  if (!configured) return `fpai-${crypto.randomUUID()}`;
  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(configured))
    fail("PROVIDER_CONFIG", "COMFYUI_CLIENT_ID must be 1–80 URL-safe characters.", 503);
  return configured;
}

export function comfyAuthHeaders(env, { json = false, accept = "application/json" } = {}) {
  const headers = new Headers();
  if (env.COMFYUI_API_KEY) headers.set("authorization", `Bearer ${env.COMFYUI_API_KEY}`);
  if (json) headers.set("content-type", "application/json");
  if (accept) headers.set("accept", accept);
  return headers;
}

export function resolveComfyUrl(base, pathWithQuery) {
  const url = new URL(base);
  const queryIndex = String(pathWithQuery).indexOf("?");
  const rawPath = queryIndex === -1 ? pathWithQuery : pathWithQuery.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : pathWithQuery.slice(queryIndex + 1);
  const relative = String(rawPath).replace(/^\/+/, "");
  const root = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${root}${relative}`.replace(/\/{2,}/g, "/");
  url.search = query;
  if (url.origin !== new URL(base).origin)
    fail("UNSAFE_PROVIDER_URL", "ComfyUI request escaped the configured origin.", 500);
  return url;
}

async function parseError(response) {
  const payload = await response.clone().json().catch(() => null);
  return (
    payload?.error?.message ||
    payload?.message ||
    (typeof payload?.error === "string" ? payload.error : null) ||
    payload?.detail ||
    payload?.error?.type ||
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

export async function comfyFetch(env, fetchImpl, path, init = {}, options = {}) {
  const target = resolveComfyUrl(comfyBaseUrl(env), path);
  try {
    const response = await fetchImpl(target, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeout || DEFAULT_TIMEOUT_MS),
    });
    const allowedRedirect = options.allowRedirect === true && response.status === 302;
    if (!response.ok && !allowedRedirect) {
      throw providerError(
        response,
        await parseError(response),
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

export function injectWorkflow(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => injectWorkflow(item, replacements));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, injectWorkflow(item, replacements)]),
    );
  if (typeof value !== "string") return value;
  if (Object.hasOwn(replacements, value)) return replacements[value];
  let next = value;
  if (Object.hasOwn(replacements, "__FPAI_PROMPT__"))
    next = next.replaceAll("__FPAI_PROMPT__", String(replacements.__FPAI_PROMPT__));
  if (Object.hasOwn(replacements, "__FPAI_ASPECT_RATIO__"))
    next = next.replaceAll("__FPAI_ASPECT_RATIO__", String(replacements.__FPAI_ASPECT_RATIO__));
  return next;
}

export function requireApiWorkflow(workflow, label = "ComfyUI") {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow))
    fail("PROVIDER_CONFIG", `${label} workflow must be an API-format JSON object.`, 503);
  if (Array.isArray(workflow.nodes) || Array.isArray(workflow.links))
    fail(
      "PROVIDER_CONFIG",
      `${label} UI-format JSON is not accepted. Export the workflow in API format.`,
      503,
    );
  return workflow;
}

function decodeBase64(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export function loadImageName(upload) {
  const name = upload?.name;
  if (!name)
    throw new ProviderError("INVALID_ASSET", "ComfyUI did not return an uploaded image name.", {
      httpStatus: 502,
    });
  const subfolder = String(upload.subfolder || "").replace(/^\/+|\/+$/g, "");
  return subfolder ? `${subfolder}/${name}` : name;
}

export async function uploadInputImage(env, fetchImpl, ref, index) {
  if (!["image/png", "image/jpeg"].includes(ref?.mimeType) || typeof ref.data !== "string")
    fail("INVALID_REFERENCES", "References must be inline PNG/JPEG images.", 400);
  const extension = ref.mimeType === "image/png" ? "png" : "jpg";
  const filename = `fpai-reference-${crypto.randomUUID()}-${index + 1}.${extension}`;
  const form = new FormData();
  form.append("image", new Blob([decodeBase64(ref.data)], { type: ref.mimeType }), filename);
  form.append("overwrite", "true");
  form.append("type", "input");
  form.append("subfolder", "fpai");
  const response = await comfyFetch(env, fetchImpl, "/upload/image", {
    method: "POST",
    headers: comfyAuthHeaders(env, { accept: "application/json" }),
    body: form,
  });
  const uploaded = await response.json().catch(() => null);
  return loadImageName(uploaded);
}

export async function submitPrompt(env, fetchImpl, workflow) {
  const clientId = comfyClientId(env);
  const response = await comfyFetch(
    env,
    fetchImpl,
    "/prompt",
    {
      method: "POST",
      headers: comfyAuthHeaders(env, { json: true }),
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    },
    { submission: true },
  );
  const payload = await response.json().catch(() => null);
  const promptId = payload?.prompt_id;
  if (!promptId)
    throw new ProviderError(
      "INVALID_OPERATION",
      "ComfyUI did not return a prompt ID; reconcile before retrying.",
      { httpStatus: 502, uncertain: true },
    );
  return { operationId: promptId, clientId };
}

export async function readHistory(env, fetchImpl, promptId) {
  const response = await comfyFetch(
    env,
    fetchImpl,
    `/history/${encodeURIComponent(promptId)}`,
    { headers: comfyAuthHeaders(env) },
  );
  return response.json().catch(() => ({}));
}

function contentTypeFor(filename, mediaType) {
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (mediaType === "video") return "video/mp4";
  return "image/png";
}

export function collectHistoryOutputs(history) {
  const outputs = history?.outputs || {};
  const records = [];
  for (const nodeOutput of Object.values(outputs)) {
    for (const [key, mediaType] of [
      ["images", "image"],
      ["gifs", "image"],
      ["videos", "video"],
    ]) {
      for (const item of nodeOutput?.[key] || []) {
        const filename = item?.filename;
        if (!filename) continue;
        const contentType = contentTypeFor(filename, mediaType);
        records.push({
          filename,
          subfolder: item.subfolder || "",
          type: item.type || "output",
          contentType,
          mediaType: contentType.startsWith("video/") ? "video" : "image",
        });
      }
    }
  }
  return records;
}

export function encodeComfyAsset({ filename, subfolder = "", type = "output", contentType }) {
  const id = new URLSearchParams({
    filename: String(filename),
    subfolder: String(subfolder || ""),
    type: String(type || "output"),
  }).toString();
  return { id, contentType: contentType || "application/octet-stream" };
}

export function decodeComfyAsset(assetId) {
  const params = new URLSearchParams(String(assetId || ""));
  const filename = params.get("filename");
  if (!filename) fail("INVALID_ASSET", "Stored ComfyUI output asset is invalid.", 502);
  return {
    filename,
    subfolder: params.get("subfolder") || "",
    type: params.get("type") || "output",
  };
}

function hasExecutionError(status) {
  const messages = status?.messages;
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => {
    const kind = Array.isArray(message) ? message[0] : message?.type;
    return kind === "execution_error" || kind === "execution_interrupted";
  });
}

export function interpretHistory(promptId, payload, { kind = "image" } = {}) {
  const history = payload?.[promptId];
  if (!history) return { status: "running" };

  const status = history.status || {};
  const statusText = String(status.status_str || "").toLowerCase();
  const failed =
    statusText === "error" ||
    statusText === "failed" ||
    statusText === "interrupted" ||
    hasExecutionError(status);
  if (failed) {
    const message =
      status?.messages?.find?.((item) => Array.isArray(item) && item[0] === "execution_error")?.[1]
        ?.exception_message || `ComfyUI job ended as ${statusText || "failed"}.`;
    return {
      status: "failed",
      error: {
        code: statusText === "interrupted" ? "COMFY_JOB_CANCELED" : "COMFY_JOB_FAILED",
        message,
        retryable: false,
      },
    };
  }

  const outputs = collectHistoryOutputs(history);
  const completed = status.completed === true || (status.completed == null && outputs.length > 0);
  if (!completed) return { status: "running" };

  const wanted =
    kind === "video"
      ? outputs.find((item) => item.mediaType === "video" || item.contentType.startsWith("video/"))
      : outputs.find((item) => item.mediaType === "image" || item.contentType.startsWith("image/"));
  if (!wanted) {
    return {
      status: "failed",
      error: {
        code: kind === "video" ? "NO_VIDEO_OUTPUT" : "NO_IMAGE_OUTPUT",
        message:
          kind === "video"
            ? "ComfyUI workflow completed without a video output."
            : "Character workflow completed without an image output.",
        retryable: false,
      },
    };
  }
  if (kind === "video" && wanted.contentType !== "video/mp4") {
    return {
      status: "failed",
      error: {
        code: "UNSUPPORTED_OUTPUT",
        message: "Film Studio currently requires the ComfyUI workflow to output video/mp4.",
        retryable: false,
      },
    };
  }
  return { status: "completed", asset: encodeComfyAsset(wanted) };
}

export async function viewOutput(env, fetchImpl, assetId) {
  const asset = decodeComfyAsset(assetId);
  const query = new URLSearchParams({
    filename: asset.filename,
    subfolder: asset.subfolder,
    type: asset.type,
  }).toString();
  let response = await comfyFetch(
    env,
    fetchImpl,
    `/view?${query}`,
    { headers: comfyAuthHeaders(env, { accept: "*/*" }) },
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
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  }
  if (!response.ok)
    fail(
      "ASSET_RETRY",
      "ComfyUI output exists but download failed. Retry status; do not regenerate.",
      502,
    );
  return response;
}

export async function cancelPrompt(env, fetchImpl, promptId) {
  const headers = comfyAuthHeaders(env, { json: true });
  try {
    await comfyFetch(env, fetchImpl, "/queue", {
      method: "POST",
      headers,
      body: JSON.stringify({ delete: [promptId] }),
    });
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
  }
  await comfyFetch(env, fetchImpl, "/interrupt", {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt_id: promptId }),
  });
  return { status: "canceled" };
}
