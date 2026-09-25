import { ProviderError, fail } from "./contract.js";
import { falAuthHeader, downloadFalAsset } from "./falQueue.js";

const ENDPOINT = "fal-ai/sync-lipsync/v3/image-to-video";
const QUEUE = `https://queue.fal.run/${ENDPOINT}`;
const OPERATION = /^sync3:([A-Za-z0-9_-]{8,128})$/;

export const sync3LiveEnabled = (env = {}) => env.SYNC3_LIVE_ENABLED === "true";

export function wavDuration(audio) {
  if (audio?.mimeType !== "audio/wav" || typeof audio.data !== "string" ||
      audio.data.length > 2800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio.data))
    fail("INVALID_AUDIO", "Upload a WAV file smaller than 2 MB.");
  const bytes = Uint8Array.from(atob(audio.data), (c) => c.charCodeAt(0));
  if (bytes.length < 44 || bytes.length > 2_000_000)
    fail("INVALID_AUDIO", "Upload a WAV file smaller than 2 MB.");
  const view = new DataView(bytes.buffer);
  const tag = (i) => String.fromCharCode(...bytes.slice(i, i + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") fail("INVALID_AUDIO", "The audio must be a WAV file.");
  let format, dataSize;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = view.getUint32(offset + 4, true);
    if (offset + 8 + length > bytes.length) fail("INVALID_AUDIO", "The WAV file is incomplete.");
    if (tag(offset) === "fmt " && length >= 16) {
      format = { codec: view.getUint16(offset + 8, true), rate: view.getUint32(offset + 16, true) };
    }
    if (tag(offset) === "data") dataSize = length;
    offset += 8 + length + (length % 2);
  }
  if (!format || !dataSize || ![1, 3].includes(format.codec) || !format.rate)
    fail("INVALID_AUDIO", "Use an uncompressed PCM WAV file.");
  const seconds = dataSize / format.rate;
  if (seconds < 5.8 || seconds > 6.2)
    fail("INVALID_AUDIO_DURATION", "The spokesperson audio must be about six seconds long.");
  return seconds;
}

function checkInput(input) {
  if (input.referenceImages?.length !== 1 || !input.referenceImages[0]?.data)
    fail("INVALID_REFERENCES", "Upload one approved spokesperson start frame.");
  return wavDuration(input.audioInput);
}

async function request(env, fetchImpl, url, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: init.method || "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        authorization: falAuthHeader(env),
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new ProviderError("PROVIDER_TRANSPORT", "fal.ai response is unknown. Check status before retrying.", {
      httpStatus: 502, uncertain: init.method === "POST",
    });
  }
  if (!response.ok)
    throw new ProviderError("PROVIDER_HTTP", `fal.ai returned HTTP ${response.status}.`, {
      httpStatus: 502, uncertain: init.method === "POST" && response.status >= 500,
    });
  return response.json().catch(() => {
    throw new ProviderError("INVALID_RESPONSE", "fal.ai returned invalid JSON. Reconcile before retrying.", {
      httpStatus: 502, uncertain: init.method === "POST",
    });
  });
}

function requestId(row) {
  const match = OPERATION.exec(String(row.operation_id || ""));
  if (!match) fail("INVALID_OPERATION", "Stored lip-sync job is invalid.", 502);
  return encodeURIComponent(match[1]);
}

export function createSyncLipsyncProvider(env = {}, fetchImpl = fetch) {
  return {
    capabilities: {
      id: "sync-lipsync-v3", label: "Spokesperson lip sync (fal.ai)",
      model: ENDPOINT, paid: true, providerFamily: "sync3",
      durations: [6], resolutions: ["720p"], aspectRatios: ["9:16"],
      maxReferences: 1, referenceImages: true, audioInput: true,
      cancelRunning: false,
      uiHint: "Use the approved portrait and six-second WAV. This is a fal.ai charge, separate from Google credit. The output follows the supplied speech; review the face before approving.",
    },
    estimate(input) {
      checkInput(input);
      const rate = Number(env.SYNC3_RATE_PER_SECOND_USD);
      if (!Number.isFinite(rate) || rate <= 0)
        fail("PROVIDER_CONFIG", "Set the current SYNC3_RATE_PER_SECOND_USD before quoting.", 503);
      return {
        estimatedCost: Number((rate * 6).toFixed(4)), currency: "USD",
        priceBasis: "operator-configured-fal-sync3-rate", ratePerSecond: rate,
      };
    },
    async start(input) {
      if (!sync3LiveEnabled(env) || !String(env.FAL_KEY || "").trim())
        fail("LIVE_DISABLED", "The spokesperson lip-sync route is not configured for live rendering.", 403);
      checkInput(input);
      const image = input.referenceImages[0];
      const payload = await request(env, fetchImpl, QUEUE, {
        method: "POST",
        body: {
          image_url: `data:${image.mimeType};base64,${image.data}`,
          audio_url: `data:audio/wav;base64,${input.audioInput.data}`,
        },
      });
      const id = payload.request_id || payload.requestId;
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(id))
        throw new ProviderError("INVALID_RESPONSE", "fal.ai submission returned no valid job ID. Reconcile before retrying.", { httpStatus: 502, uncertain: true });
      return { operationId: `sync3:${id}`, costBasis: "fal-sync3-output-seconds-at-quoted-rate" };
    },
    async status(row) {
      const id = requestId(row);
      const state = await request(env, fetchImpl, `${QUEUE}/requests/${id}/status`);
      if (["IN_QUEUE", "IN_PROGRESS"].includes(state.status)) return { status: "running" };
      if (state.status === "FAILED") return { status: "failed", actualCost: 0, error: { code: "PROVIDER_FAILED", message: "Lip-sync generation failed." } };
      if (state.status !== "COMPLETED") fail("INVALID_STATUS", "fal.ai returned an unknown lip-sync status.", 502);
      const result = await request(env, fetchImpl, `${QUEUE}/requests/${id}`);
      if (!result.video?.url) fail("NO_OUTPUT", "fal.ai completed without a video.", 502);
      return {
        status: "completed", actualCost: Number(row.estimated_cost),
        costBasis: "fal-sync3-output-seconds-at-quoted-rate",
        asset: { url: result.video.url },
      };
    },
    async cancel() { fail("CANCEL_UNSUPPORTED", "This lip-sync job cannot be canceled after submission.", 409); },
    async asset(row) {
      const asset = JSON.parse(row.asset_json || "null");
      return downloadFalAsset(fetchImpl, asset?.url);
    },
  };
}
