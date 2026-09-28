import { ProviderError, fail } from "./contract.js";

const ORIGIN = "https://api.higgsfield.ai";
export const isHiggsfieldProvider = (id) => ["higgsfield-kling-3-standard", "higgsfield-kling-3-pro"].includes(id);
export const higgsfieldConfigured = (env) => /^[^\s:]+:[^\s:]+$/.test(String(env.HF_CREDENTIALS || ""));
export const higgsfieldLiveEnabled = (env) => env.HIGGSFIELD_LIVE_ENABLED === "true";

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
function auth(env) {
  if (!higgsfieldConfigured(env)) fail("PROVIDER_CONFIG", "Set the server HF_CREDENTIALS secret to KEY_ID:KEY_SECRET.", 503);
  return { Authorization: `Key ${env.HF_CREDENTIALS}` };
}
async function checked(response, stage) {
  if (!response.ok) throw new ProviderError("HIGGSFIELD_API_ERROR", `Higgsfield ${stage} failed (HTTP ${response.status}).`, { httpStatus: 502, retryable: response.status >= 500 });
  return response;
}

export function createHiggsfieldProvider(env = {}, fetchImpl = fetch, tier = "pro") {
  if (!["pro", "standard"].includes(tier)) fail("PROVIDER_CONFIG", "Unknown Higgsfield tier.");
  const id = `higgsfield-kling-3-${tier}`;
  const model = `kling-video/v3.0/${tier === "pro" ? "pro" : "std"}/image-to-video`;
  const resolution = tier === "pro" ? "1080p" : "720p";
  function estimate(input) {
    if (input.referenceImages?.length !== 1) fail("INVALID_REFERENCES", "Higgsfield requires one composed shot start frame.");
    const rateKey = `HIGGSFIELD_KLING3_${tier.toUpperCase()}_${input.generateAudio === false ? "SILENT" : "AUDIO"}_RATE_PER_SECOND_USD`;
    const rate = Number(env[rateKey]);
    if (!Number.isFinite(rate) || rate <= 0) fail("PROVIDER_CONFIG", `${rateKey} must match your current Higgsfield console rate.`, 503);
    return { estimatedCost: Number((input.duration * rate).toFixed(4)), currency: "USD", ratePerSecond: rate, priceBasis: "operator-configured-higgsfield-rate" };
  }
  return {
    capabilities: {
      id, label: `Higgsfield · Kling 3.0 ${tier === "pro" ? "Pro" : "Standard"}`, model,
      paid: true, providerFamily: "higgsfield", durations: [5, 10], resolutions: [resolution],
      aspectRatios: ["16:9", "9:16"], maxReferences: 1, referenceImages: true,
      audio: true, generateAudio: true, cancelRunning: false,
      ledgerRoutes: { [resolution]: id },
      uiHint: "One composed start frame. Output framing follows your image; use an image matching the selected aspect ratio. Prices require current audio-specific console rates.",
    },
    estimate,
    async start(input) {
      if (!higgsfieldLiveEnabled(env)) fail("LIVE_DISABLED", "Higgsfield live rendering is disabled.", 403);
      const headers = auth(env);
      estimate(input);
      const ref = input.referenceImages[0];
      const upload = await (await checked(await fetchImpl(`${ORIGIN}/files/generate-upload-url`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: ref.mimeType }), redirect: "error",
      }), "upload initialization")).json();
      const uploadUrl = safeUrl(upload.upload_url);
      const imageUrl = safeUrl(upload.public_url);
      const uploadHeaders = { ...(upload.upload_headers || {}), "Content-Type": ref.mimeType };
      for (const name of Object.keys(uploadHeaders)) if (/authorization|cookie/i.test(name)) delete uploadHeaders[name];
      await checked(await fetchImpl(uploadUrl, { method: "PUT", headers: uploadHeaders,
        body: Uint8Array.from(atob(ref.data), c => c.charCodeAt(0)), redirect: "error" }), "image upload");
      // A lost or malformed submission response may still represent a billed job.
      try {
        const response = await fetchImpl(`${ORIGIN}/${model}`, {
          method: "POST", headers: { ...headers, "Content-Type": "application/json" }, redirect: "error",
          body: JSON.stringify({ image_url: imageUrl, prompt: input.prompt, duration: input.duration,
            sound: input.generateAudio === false ? "off" : "on", cfg_scale: 0.5, multi_shots: false }),
        });
        if (!response.ok && response.status >= 400 && response.status < 500) await checked(response, "submission");
        if (!response.ok) throw new Error("Unknown submission outcome");
        const payload = await response.json();
        if (!/^[a-f0-9-]{36}$/i.test(payload.request_id)) throw new Error("Missing request ID");
        const statusUrl = safeUrl(payload.status_url, true);
        if (new URL(statusUrl).pathname !== `/requests/${payload.request_id}/status`) throw new Error("Mismatched status URL");
        return { operationId: statusUrl, costBasis: "higgsfield-configured-rate-estimate" };
      } catch (error) {
        if (error.code === "HIGGSFIELD_API_ERROR") throw error;
        throw new ProviderError("HIGGSFIELD_SUBMISSION_UNKNOWN", "Higgsfield submission outcome is unknown. Check provider usage before retrying.", { uncertain: true, httpStatus: 502 });
      }
    },
    async status(row) {
      // Polling remains possible when new submissions are disabled.
      const response = await checked(await fetchImpl(safeUrl(row.operation_id, true), { headers: auth(env), redirect: "error" }), "status");
      const result = await response.json();
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
      return checked(await fetchImpl(safeUrl(asset?.url), { redirect: "error" }), "video download");
    },
    async cancel() { fail("CANCEL_UNSUPPORTED", "Higgsfield jobs cannot be canceled from Studio after submission.", 409); },
  };
}
