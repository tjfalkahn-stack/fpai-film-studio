import { ProviderError, fail } from "./contract.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/";
const MODEL = "veo-3.1-fast-generate-preview";
const RATES = { "720p": 0.1, "1080p": 0.12 };

export function createVeoProvider(env, fetchImpl = fetch) {
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
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
      });
      if (!response.ok)
        throw new ProviderError(
          "PROVIDER_HTTP",
          `Google returned HTTP ${response.status}.`,
          {
            httpStatus: 502,
            retryable: response.status === 429 || response.status >= 500,
            uncertain: init.method === "POST" && response.status >= 500,
          },
        );
      return await response.json();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "PROVIDER_TRANSPORT",
        "Google response was not received safely; do not resubmit.",
        { httpStatus: 502, retryable: true, uncertain: init.method === "POST" },
      );
    }
  }
  return {
    capabilities: {
      id: "veo-fast",
      label: "Veo 3.1 Fast",
      paid: true,
      ledgerRoutes: { "720p": "veo-fast-720", "1080p": "veo-fast-1080" },
      model: MODEL,
      durations: [4, 6, 8],
      resolutions: ["720p", "1080p"],
      aspectRatios: ["16:9", "9:16"],
      maxReferences: 3,
      cancelRunning: false,
    },
    estimate: (input) => ({
      estimatedCost:
        Math.round(input.duration * RATES[input.resolution] * 10000) / 10000,
      currency: "USD",
      priceBasis: "published-rate-2026-09-07",
    }),
    async start(input) {
      const instance = { prompt: input.prompt };
      if (input.referenceImages.length)
        instance.referenceImages = input.referenceImages.map((ref) => ({
          image: { inlineData: { mimeType: ref.mimeType, data: ref.data } },
          referenceType: "asset",
        }));
      const operation = await google(`models/${MODEL}:predictLongRunning`, {
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
      // Google does not return invoice cost. Record completed usage at the reserved tariff;
      // expose the basis explicitly and reconcile it with the provider bill later.
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
      // A redirect is followed without credentials; never forward the API key to another host.
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
          redirect: "error",
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
