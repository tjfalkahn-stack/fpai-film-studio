import { ProviderError, fail } from "./contract.js";
import { serveHiggsfieldInput, signedHiggsfieldInputUrl } from "./higgsfieldInput.js";
import { referenceVideoExists, signedReferenceVideoUrl } from "../referenceVideos.js";

const ORIGIN = "https://api.higgsfield.ai";
const seconds = (minimum, maximum) => Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);
export const HIGGSFIELD_MODELS = Object.freeze({
  "higgsfield-kling-3-standard": { model: "kling-video/v3.0/std/image-to-video", label: "Kling 3.0 Standard · image", kind: "image", resolutions: ["720p"], durations: seconds(3, 15), price: "HIGGSFIELD_KLING3_STANDARD" },
  "higgsfield-kling-3-pro": { model: "kling-video/v3.0/pro/image-to-video", label: "Kling 3.0 Pro · image", kind: "image", resolutions: ["1080p"], durations: seconds(3, 15), price: "HIGGSFIELD_KLING3_PRO" },
  "higgsfield-kling-3-standard-text": { model: "kling-video/v3.0/std/text-to-video", label: "Kling 3.0 Standard · text", kind: "text", resolutions: ["720p"], durations: seconds(3, 15), price: "HIGGSFIELD_KLING3_STANDARD" },
  "higgsfield-kling-3-pro-text": { model: "kling-video/v3.0/pro/text-to-video", label: "Kling 3.0 Pro · text", kind: "text", resolutions: ["1080p"], durations: seconds(3, 15), price: "HIGGSFIELD_KLING3_PRO" },
  "higgsfield-seedance-2.5-text": { model: "bytedance/seedance-2.5/text-to-video", label: "Seedance 2.5 · text", kind: "text", resolutions: ["720p", "480p"], durations: seconds(4, 30), price: "HIGGSFIELD_SEEDANCE25" },
  "higgsfield-seedance-2.5-image": { model: "bytedance/seedance-2.5/image-to-video", label: "Seedance 2.5 · image", kind: "image", resolutions: ["720p", "480p"], durations: seconds(4, 30), price: "HIGGSFIELD_SEEDANCE25" },
  "higgsfield-genjutsu-motion": { model: "higgsfield/genjutsu/motion-transfer/v1.0", label: "Genjutsu · motion transfer", kind: "motion", resolutions: ["720p", "480p", "1080p"], durations: seconds(1, 30), price: "HIGGSFIELD_GENJUTSU" },
});
export const isHiggsfieldProvider = (id) => Object.hasOwn(HIGGSFIELD_MODELS, id);
// Higgsfield's API keys page supplies one complete credential. Pass it as copied.
export const higgsfieldConfigured = (env) => /^\S+$/.test(String(env.HF_CREDENTIALS || "").trim());
export const higgsfieldLiveEnabled = (env) => higgsfieldConfigured(env);

function safeUrl(value, api = false) {
  let url;
  try { url = new URL(value); } catch { fail("HIGGSFIELD_RESPONSE", "Invalid Higgsfield media or status URL.", 502); }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":") ||
      /(^|\.)(localhost|local|internal)$/.test(url.hostname) ||
      (api && (url.origin !== ORIGIN || !/^\/requests\/[a-f0-9-]+\/status$/i.test(url.pathname))))
    fail("HIGGSFIELD_RESPONSE", "Unsafe Higgsfield response URL.", 502);
  return url.href;
}
function motionVideoRef(input) {
  const videos = Array.isArray(input.referenceVideos) ? input.referenceVideos : [];
  if (videos.length !== 1) fail("INVALID_REFERENCES", "Motion transfer needs one HTTPS reference video URL or one uploaded MP4.");
  const video = videos[0] || {};
  if (typeof video.assetId === "string" && /^[a-f0-9-]{36}$/i.test(video.assetId)) return { kind: "asset", assetId: video.assetId };
  if (typeof video.url === "string" && video.url) return { kind: "url", url: safeUrl(video.url) };
  fail("INVALID_REFERENCES", "Motion transfer needs one HTTPS reference video URL or one uploaded MP4.");
}
async function motionVideoUrl(env, input) {
  const video = motionVideoRef(input);
  if (video.kind === "url") return video.url;
  if (env.GENERATION_MEDIA && !(await referenceVideoExists(env, video.assetId))) {
    fail("INVALID_REFERENCES", "Upload the reference MP4 again before generating.", 404);
  }
  return signedReferenceVideoUrl(env, video.assetId);
}
function auth(env) {
  if (!higgsfieldConfigured(env)) fail("PROVIDER_CONFIG", "Set the server HF_CREDENTIALS secret to the complete Higgsfield API key.", 503);
  return { Authorization: `Key ${String(env.HF_CREDENTIALS).trim()}` };
}
function request(fetchImpl, url, init = {}) {
  // Workers rejects redirect: "error" before contacting the origin, which
  // previously discarded Higgsfield's HTTP status during image-upload init.
  return fetchImpl(url, { ...init, redirect: "manual" });
}
function providerDetail(text, env) {
  const credential = String(env.HF_CREDENTIALS || "").trim();
  let value = String(text || "");
  if (credential) value = value.replaceAll(credential, "[redacted]");
  return value.replace(/https?:\/\/[^\s"'\\]+/gi, "[url]").replace(/\s+/g, " ").trim().slice(0, 180);
}
async function jsonDetail(response, env) {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text);
    const detail = parsed?.detail;
    if (typeof detail === "string") return providerDetail(detail, env);
    if (Array.isArray(detail)) {
      return providerDetail(detail.map((item) => item?.msg || item?.message || "").filter(Boolean).join("; "), env);
    }
  } catch {}
  return "";
}
export async function probeHiggsfieldUploadConnection(env, fetchImpl = fetch) {
  const startedAt = Date.now();
  if (!higgsfieldConfigured(env)) return { transport: "not-configured" };
  try {
    // Requesting an upload slot does not submit a video. Never return its signed URLs.
    const response = await request(fetchImpl, `${ORIGIN}/files/generate-upload-url`, {
      method: "POST", headers: { ...auth(env), "Content-Type": "application/json" },
      body: JSON.stringify({ content_type: "image/png" }),
      signal: AbortSignal.timeout(10000),
    });
    return { transport: "response", httpStatus: response.status, redirect: response.status >= 300 && response.status < 400, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    const credential = String(env.HF_CREDENTIALS || "").trim();
    return {
      transport: "error",
      errorType: ["TimeoutError", "AbortError", "TypeError"].includes(error?.name) ? error.name : "OtherError",
      errorDetail: String(error?.message || "unknown").replaceAll(credential, "[redacted]").replace(/https?:\/\/\S+/g, "[url]").slice(0, 180),
      elapsedMs: Date.now() - startedAt,
    };
  }
}
async function checked(response, stage, env) {
  if (response.ok) return response;
  const detail = await jsonDetail(response, env);
  throw new ProviderError("HIGGSFIELD_API_ERROR", `Higgsfield ${stage} failed (HTTP ${response.status}${detail ? `: ${detail}` : ""}).`, {
    httpStatus: 502,
    retryable: response.status >= 500,
    providerHttpStatus: response.status,
    ...(detail ? { providerDetails: detail } : {}),
  });
}
async function verifySignedInputs(env, urls) {
  for (const href of urls) {
    const served = await serveHiggsfieldInput(new Request(href), env);
    if (!served || served.status !== 200) throw new Error("stored image is not readable");
    const type = served.headers.get("content-type");
    if (!["image/png", "image/jpeg"].includes(type)) throw new Error("stored image is not readable");
    const body = await served.arrayBuffer();
    if (!body.byteLength) throw new Error("stored image is not readable");
  }
}
function preparationError(uploadStage, error) {
  const http = error.providerHttpStatus ? `HTTP ${error.providerHttpStatus}` : "";
  const detail = typeof error.providerDetails === "string" ? error.providerDetails : "";
  const transport = !http && ["TimeoutError", "AbortError", "TypeError"].includes(error?.name) ? error.name : "";
  const suffix = [http, detail || transport].filter(Boolean).join(": ");
  return new ProviderError(
    "HIGGSFIELD_IMAGE_PREPARATION",
    `Higgsfield ${uploadStage} failed before video submission${suffix ? ` (${suffix})` : ""}. No video request was submitted.`,
    {
      httpStatus: 502,
      retryable: true,
      ...(error.providerHttpStatus ? { providerHttpStatus: error.providerHttpStatus } : {}),
      ...(detail ? { providerDetails: detail } : {}),
    },
  );
}

export function createHiggsfieldProvider(env = {}, fetchImpl = fetch, route = "pro") {
  const id = HIGGSFIELD_MODELS[route] ? route : `higgsfield-kling-3-${route}`;
  const spec = HIGGSFIELD_MODELS[id];
  if (!spec) fail("PROVIDER_CONFIG", "Unknown Higgsfield model.");
  const { model } = spec;
  function estimate(input) {
    const refs = input.referenceImages || [];
    if (spec.kind === "image" && refs.length !== 1) fail("INVALID_REFERENCES", "This model requires one composed Shot Start Frame.");
    if (input.endFrameImage && spec.kind !== "image") fail("INVALID_REFERENCES", "This model does not accept an end frame.");
    if (spec.kind === "text" && refs.length) fail("INVALID_REFERENCES", "Text to video does not take image references.");
    if (spec.kind === "motion") {
      if (!refs.length || refs.length > 8) fail("INVALID_REFERENCES", "Motion transfer needs one to eight reference images.");
      motionVideoRef(input);
    }
    const sound = input.generateAudio === false ? "SILENT" : "AUDIO";
    const rateKey = spec.kind === "motion"
      ? `${spec.price}_${input.resolution}_RATE_PER_SECOND_USD`.toUpperCase()
      : spec.price === "HIGGSFIELD_SEEDANCE25"
        ? `${spec.price}_${input.resolution}_${sound}_RATE_PER_SECOND_USD`.toUpperCase()
        : `${spec.price}_${sound}_RATE_PER_SECOND_USD`;
    // Published pre-discount rates provide a usable quote with only HF_CREDENTIALS.
    // Explicit Worker variables override these when the owner's account differs.
    const publishedRate = spec.kind === "motion"
      ? { "480p": 0.318, "720p": 0.681, "1080p": 1.632 }[input.resolution]
      : spec.price === "HIGGSFIELD_SEEDANCE25"
        ? Number((Math.ceil((input.resolution === "480p" ? 854 * 480 : 1280 * 720) * 24 / 1024) * 0.0214 / 1000).toFixed(5))
        : spec.price === "HIGGSFIELD_KLING3_PRO"
          ? (input.generateAudio === false ? 0.112 : 0.168)
          : (input.generateAudio === false ? 0.084 : 0.126);
    const rate = Number(env[rateKey] ?? publishedRate);
    if (!Number.isFinite(rate) || rate <= 0) fail("PROVIDER_CONFIG", `${rateKey} must match your current Higgsfield console rate.`, 503);
    return { estimatedCost: Number((input.duration * rate).toFixed(4)), currency: "USD", ratePerSecond: rate, priceBasis: env[rateKey] == null ? "published-pre-discount-estimate" : "operator-configured-higgsfield-rate" };
  }
  return {
    capabilities: {
      id, label: `Higgsfield · ${spec.label}`, model, inputKind: spec.kind,
      paid: true, providerFamily: "higgsfield", durations: spec.durations, resolutions: spec.resolutions,
      aspectRatios: ["16:9", "9:16"], maxReferences: spec.kind === "motion" ? 8 : spec.kind === "image" ? 1 : 0,
      supportsEndFrame: spec.kind === "image",
      referenceImages: spec.kind !== "text", requiresStartFrame: spec.kind === "image",
      requiresVideoUrl: spec.kind === "motion", audio: spec.kind !== "motion", generateAudio: spec.kind !== "motion", cancelRunning: false,
      ledgerRoutes: Object.fromEntries(spec.resolutions.map(resolution => [resolution, id])),
      uiHint: spec.kind === "motion" ? "Upload an MP4 or paste a public HTTPS clip URL, then add one to eight character images. Match Source duration to the clip for the cost quote." : spec.kind === "image" ? "Upload a start frame and, optionally, an end frame. Match their aspect ratios." : "Text only; no frames are sent.",
    },
    estimate,
    async start(input) {
      const headers = auth(env);
      estimate(input);
      const motionUrl = spec.kind === "motion" ? await motionVideoUrl(env, input) : null;
      const imageUrls = [];
      let uploadStage = "image preparation";
      try {
        if (spec.kind === "image" && input.renderId) {
          uploadStage = "signed input link creation";
          imageUrls.push(await signedHiggsfieldInputUrl(env, input.renderId));
          if (input.endFrameImage) imageUrls.push(await signedHiggsfieldInputUrl(env, input.renderId, Date.now(), "end"));
        }
        if (spec.kind === "motion" && input.renderId) {
          uploadStage = "signed input link creation";
          for (let index = 0; index < input.referenceImages.length; index++)
            imageUrls.push(await signedHiggsfieldInputUrl(env, input.renderId, Date.now(), `ref-${index}`));
        }
        if (imageUrls.length && input.renderId) {
          uploadStage = "signed input verification";
          await verifySignedInputs(env, imageUrls);
        }
        const uploadRefs = ["image", "motion"].includes(spec.kind) && input.renderId ? [] : [
          ...(input.referenceImages || []),
          ...(spec.kind === "image" && input.endFrameImage ? [input.endFrameImage] : []),
        ];
        for (const ref of uploadRefs) {
          uploadStage = "upload initialization";
          const upload = await (await checked(await request(fetchImpl, `${ORIGIN}/files/generate-upload-url`, {
            method: "POST", headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ content_type: ref.mimeType }),
          }), "upload initialization", env)).json();
          uploadStage = "upload URL validation";
          const uploadUrl = safeUrl(upload.upload_url);
          const imageUrl = safeUrl(upload.public_url);
          const uploadHeaders = { ...(upload.upload_headers || {}) };
          if (!Object.keys(uploadHeaders).some(name => name.toLowerCase() === "content-type")) uploadHeaders["Content-Type"] = ref.mimeType;
          for (const name of Object.keys(uploadHeaders)) if (/authorization|cookie/i.test(name)) delete uploadHeaders[name];
          uploadStage = "image decoding";
          const bytes = Uint8Array.from(atob(ref.data), c => c.charCodeAt(0));
          uploadStage = "storage upload";
          await checked(await request(fetchImpl, uploadUrl, { method: "PUT", headers: uploadHeaders,
            body: bytes }), "image upload", env);
          imageUrls.push(imageUrl);
        }
      } catch (error) {
        if (error instanceof ProviderError && error.code === "HIGGSFIELD_IMAGE_PREPARATION") throw error;
        // Nothing has been sent to the paid generation endpoint yet.
        throw preparationError(uploadStage, error);
      }
      const payload = spec.kind === "motion"
        ? { prompt: input.prompt, video_url: motionUrl, image_urls: imageUrls, resolution: input.resolution }
        : spec.price === "HIGGSFIELD_SEEDANCE25"
          ? { prompt: input.prompt, duration: input.duration, resolution: input.resolution,
              ...(spec.kind === "image" ? { image_url: imageUrls[0], ...(input.endFrameImage ? { end_image_url: imageUrls[1] } : {}) } : { aspect_ratio: input.aspectRatio }),
              output_format: "mp4", generate_audio: input.generateAudio !== false }
          : { ...(spec.kind === "image" ? { image_url: imageUrls[0], ...(input.endFrameImage ? { last_image_url: imageUrls[1] } : {}) } : { aspect_ratio: input.aspectRatio }),
              prompt: input.prompt, duration: input.duration, sound: input.generateAudio === false ? "off" : "on",
              cfg_scale: 0.5, multi_shots: false };
      // A lost or malformed submission response may still represent a billed job.
      let submissionDetail = "transport error";
      try {
        const response = await request(fetchImpl, `${ORIGIN}/${model}`, {
          method: "POST", headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok && response.status >= 400 && response.status < 500) await checked(response, "submission", env);
        submissionDetail = `HTTP ${response.status}`;
        if (!response.ok) throw new Error("Unknown submission outcome");
        submissionDetail = "HTTP 2xx with unreadable JSON";
        const result = await response.json();
        submissionDetail = "HTTP 2xx without a valid request ID";
        if (!/^[a-f0-9-]{36}$/i.test(result.request_id)) throw new Error("Missing request ID");
        // Higgsfield's request ID is the durable acknowledgement. Poll its documented
        // canonical route rather than trusting a provider-supplied URL or dropping a
        // successfully accepted request when that optional URL differs.
        const statusUrl = `${ORIGIN}/requests/${result.request_id}/status`;
        return { operationId: statusUrl, costBasis: "higgsfield-configured-rate-estimate" };
      } catch (error) {
        if (error.code === "HIGGSFIELD_API_ERROR") throw error;
        throw new ProviderError("HIGGSFIELD_SUBMISSION_UNKNOWN", `Higgsfield submission outcome is unknown (${submissionDetail}). Check provider usage before retrying.`, { uncertain: true, httpStatus: 502 });
      }
    },
    async status(row) {
      // Polling remains possible when new submissions are disabled.
      let result;
      try {
        const response = await checked(await request(fetchImpl, safeUrl(row.operation_id, true), { headers: auth(env) }), "status", env);
        result = await response.json();
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError("HIGGSFIELD_STATUS_UNAVAILABLE", "Studio could not read this job from Higgsfield. No new video was submitted. Retry recovery later or download it from Higgsfield Requests.", { httpStatus: 502, retryable: true });
      }
      if (["queued", "in_progress"].includes(result.status)) return { status: "running" };
      if (["failed", "nsfw", "canceled"].includes(result.status)) return {
        status: "failed", actualCost: Number(row.estimated_cost), costBasis: "reserved-estimate-pending-provider-reconciliation",
        error: { code: `HIGGSFIELD_${result.status.toUpperCase()}`, message: `Higgsfield request ${result.status}. Check the provider console for billing reconciliation.` },
      };
      if (result.status !== "completed") fail("HIGGSFIELD_RESPONSE", "Unrecognized Higgsfield status.", 502);
      return { status: "completed", actualCost: Number(row.estimated_cost), costBasis: "higgsfield-configured-rate-estimate", asset: { url: safeUrl(result.video?.url) } };
    },
    async asset(row) {
      const asset = JSON.parse(row.asset_json || "null");
      return checked(await request(fetchImpl, safeUrl(asset?.url)), "video download", env);
    },
    async cancel() { fail("CANCEL_UNSUPPORTED", "Higgsfield jobs cannot be canceled from Studio after submission.", 409); },
  };
}
