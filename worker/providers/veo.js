import { ProviderError, fail } from "./contract.js";
import { YARD_PROJECT_ID } from "../../src/yardProduction.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/";
const TIERS = {
  lite: { model: "veo-3.1-lite-generate-preview", rates: { "720p": 0.05, "1080p": 0.08 } },
  fast: { model: "veo-3.1-fast-generate-preview", rates: { "720p": 0.1, "1080p": 0.12 } },
  standard: { model: "veo-3.1-generate-preview", rates: { "720p": 0.4, "1080p": 0.4 } },
};

function httpHint(status) {
  if (status === 400) return "Check the selected input mode, images, duration, and resolution.";
  if (status === 401 || status === 403) return "Check the Gemini key, project access, billing, and region eligibility.";
  if (status === 404) return "Check that this Google model or operation is available to the configured project.";
  if (status === 429) return "Google quota or rate limit was reached. Check quota before another take.";
  if (status >= 500) return "Google has a service error; reconcile a submitted take before retrying.";
  return "Check the Google provider connection.";
}

export function createVeoProvider(env, fetchImpl = fetch, tier = "fast") {
  const { model, rates } = TIERS[tier];
  const enabled = () => {
    if (
      env.LIVE_RENDERING_ENABLED !== "true" ||
      env.MOCK_E2E_VERIFIED !== "true"
    )
      fail("LIVE_DISABLED", "Live rendering is disabled.", 403);
    if (!env.GEMINI_API_KEY)
      fail("PROVIDER_CONFIG", "Gemini key is not configured.", 503);
  };
  async function google(path, init = {}) {
    enabled();
    try {
      const response = await fetchImpl(new URL(path, BASE), {
        ...init,
        // Workers rejects redirect: "error" before contacting Google.
        // Manual mode returns a 3xx without forwarding the API key elsewhere.
        redirect: "manual",
        signal: AbortSignal.timeout(init.method === "POST" ? 90000 : 30000),
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
      });
      if (!response.ok)
        throw new ProviderError(
          "PROVIDER_HTTP",
          `Google returned HTTP ${response.status}. ${httpHint(response.status)}`,
          {
            httpStatus: 502,
            retryable: response.status === 429 || response.status >= 500,
            uncertain: init.method === "POST" && (response.status >= 500 || (response.status >= 300 && response.status < 400)),
          },
        );
      return await response.json();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "PROVIDER_TRANSPORT",
        init.method === "POST"
          ? "Google's submission response was lost. This take may still be charged; a new take could add another charge."
          : "Google's status response could not be read. Retry status for the existing take; do not submit a replacement.",
        { httpStatus: 502, retryable: true, uncertain: init.method === "POST" },
      );
    }
  }
  return {
    capabilities: {
      id: `veo-${tier}`,
      label: `Google Veo 3.1 ${tier[0].toUpperCase()}${tier.slice(1)}`,
      paid: true,
      ledgerRoutes: { "720p": `veo-${tier}-720`, "1080p": `veo-${tier}-1080` },
      model,
      durations: [4, 6, 8],
      resolutions: ["720p", "1080p"],
      aspectRatios: ["16:9", "9:16"],
      maxReferences: tier === "lite" ? 1 : 3,
      referenceModes: tier === "lite" ? ["start-frame"] : ["reference-images", "start-frame"],
      cancelRunning: false,
      forceEightSecondSource: true,
      supportsEndFrame: true,
      nativeAudio: true,
    },
    estimate: (input) => ({
      estimatedCost:
        Math.round(input.duration * rates[input.resolution] * 10000) / 10000,
      currency: "USD",
      priceBasis: "published-rate-2026-09-07",
    }),
    async start(input) {
      const instance = { prompt: input.prompt };
      if (input.referenceMode && !["reference-images", "start-frame"].includes(input.referenceMode))
        fail("UNSUPPORTED_INPUT", "Unsupported Veo image input mode.");
      if (tier === "lite" && input.referenceMode === "reference-images" && input.referenceImages.length)
        fail("UNSUPPORTED_INPUT", "Veo Lite accepts a start frame, not character reference images.");
      const usesStartFrame = input.referenceMode === "start-frame" ||
        (input.projectId === YARD_PROJECT_ID && input.referenceImages.length === 1);
      if (usesStartFrame && input.referenceImages.length !== 1)
        fail("INVALID_REFERENCES", "Veo start-frame mode requires exactly one composed shot image.");
      if (input.endFrameImage && !usesStartFrame)
        fail("INVALID_REFERENCES", "Veo end frame requires one start frame.");
      if (usesStartFrame) {
        const ref = input.referenceImages[0];
        instance.image = { inlineData: { mimeType: ref.mimeType, data: ref.data } };
        if (input.endFrameImage)
          instance.lastFrame = { inlineData: { mimeType: input.endFrameImage.mimeType, data: input.endFrameImage.data } };
      } else if (input.referenceImages.length)
        instance.referenceImages = input.referenceImages.map((ref) => ({
          image: { inlineData: { mimeType: ref.mimeType, data: ref.data } },
          referenceType: "asset",
        }));
      const operation = await google(`models/${model}:predictLongRunning`, {
        method: "POST",
        body: JSON.stringify({
          instances: [instance],
          parameters: {
            sampleCount: 1,
            aspectRatio: input.aspectRatio,
            durationSeconds: input.duration,
            resolution: input.resolution,
            personGeneration: input.referenceImages.length
              ? "allow_adult"
              : "allow_all",
          },
        }),
      });
      if (
        !operation.name ||
        !/^models\/[\w.-]+\/operations\/[\w-]+$/.test(operation.name)
      )
        throw new ProviderError(
          "INVALID_OPERATION",
          "Google did not return a valid operation ID; reconcile before retrying.",
          { uncertain: true },
        );
      return { operationId: operation.name };
    },
    async status(job) {
      if (!/^models\/[\w.-]+\/operations\/[\w-]+$/.test(job.operation_id || ""))
        fail("INVALID_OPERATION", "Stored operation is invalid.");
      const operation = await google(job.operation_id);
      if (!operation.done) return { status: "running" };
      if (operation.error)
        return {
          status: "failed",
          actualCost: 0,
          costBasis: "provider-failed-no-video",
          error: {
            code: "PROVIDER_FAILED",
            message: "Google reported generation failure.",
            retryable: false,
          },
        };
      const asset =
        operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
      if (!asset?.uri)
        return {
          status: "failed",
          actualCost: 0,
          costBasis: "provider-no-video",
          error: {
            code: "NO_OUTPUT",
            message: "Google returned no video (possibly filtered).",
            retryable: false,
          },
        };
      return {
        status: "completed",
        actualCost: job.estimated_cost,
        costBasis: "completed-usage-at-quoted-rate",
        asset,
      };
    },
    cancel: async () =>
      fail(
        "CANCEL_UNSUPPORTED",
        "Google does not guarantee cancellation of a submitted Veo operation. It remains tracked and reserved.",
        409,
      ),
    async asset(job) {
      enabled();
      const uri = new URL(JSON.parse(job.asset_json).uri);
      if (
        uri.origin !== "https://generativelanguage.googleapis.com" ||
        !uri.pathname.startsWith("/v1beta/files/")
      )
        fail(
          "UNSAFE_ASSET_URL",
          "Google returned an unexpected asset location.",
          502,
        );
      let response = await fetchImpl(uri, {
        headers: { "x-goog-api-key": env.GEMINI_API_KEY },
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = new URL(response.headers.get("location"), uri);
        if (
          target.protocol !== "https:" ||
          !(
            target.hostname.endsWith(".googleusercontent.com") ||
            target.hostname.endsWith(".googleapis.com")
          )
        )
          fail("UNSAFE_ASSET_URL", "Unexpected download redirect.", 502);
        response = await fetchImpl(target, {
          redirect: "manual",
          signal: AbortSignal.timeout(30000),
        });
      }
      if (!response.ok)
        fail(
          "ASSET_RETRY",
          "Video was generated but download failed. Retry status; no regeneration is needed.",
          502,
        );
      return response;
    },
  };
}
