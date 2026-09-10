import { ProviderError, fail } from "./contract.js";
import {
  downloadFalAsset,
  encodeFalOperationId,
  falQueueRequest,
  parseFalOperationId,
} from "./falQueue.js";
import {
  SEEDANCE_ASPECT_RATIOS,
  SEEDANCE_DURATIONS,
  SEEDANCE_FAST_RESOLUTIONS,
  SEEDANCE_MAX_REFERENCE_IMAGES,
  SEEDANCE_STANDARD_RESOLUTIONS,
  buildSeedanceRequest,
  seedanceSelectionRationale,
  seedanceTier,
} from "../../src/seedanceRequest.js";
import { SEEDANCE_PRICE_BASIS } from "../../src/seedancePricing.js";

const TIER_META = {
  fast: {
    id: "seedance-fast",
    label: "Seedance 2.0 Fast",
    model: "bytedance/seedance-2.0/fast",
    resolutions: [...SEEDANCE_FAST_RESOLUTIONS],
    ledgerRoutes: { "720p": "seedance-fast-720" },
    uiHint:
      "Draft motion, coverage, transitions, and inexpensive reference-driven tests. Audio-capable. Up to 9 Character Bible and scene references.",
  },
  standard: {
    id: "seedance-standard",
    label: "Seedance 2.0 Standard",
    model: "bytedance/seedance-2.0",
    resolutions: [...SEEDANCE_STANDARD_RESOLUTIONS],
    ledgerRoutes: { "720p": "seedance-standard-720", "1080p": "seedance-standard-1080" },
    uiHint:
      "Higher-quality cinematic character shots, reference-driven scenes, and audio-enabled takes. Up to 9 Character Bible and scene references.",
  },
};

export function seedanceLiveEnabled(env = {}) {
  return (
    env.LIVE_RENDERING_ENABLED === "true" &&
    env.MOCK_E2E_VERIFIED === "true" &&
    env.SEEDANCE_LIVE_ENABLED === "true"
  );
}

function requireSeedanceLive(env) {
  if (env.LIVE_RENDERING_ENABLED !== "true" || env.MOCK_E2E_VERIFIED !== "true") {
    fail("LIVE_DISABLED", "Live rendering is disabled.", 403);
  }
  if (env.SEEDANCE_LIVE_ENABLED !== "true") {
    fail("LIVE_DISABLED", "Seedance live rendering is disabled.", 403);
  }
  if (!String(env.FAL_KEY || "").trim()) {
    fail("PROVIDER_CONFIG", "FAL_KEY is not configured.", 503);
  }
}

function capabilitiesFor(tier) {
  const meta = TIER_META[tier];
  return {
    id: meta.id,
    label: meta.label,
    paid: true,
    ledgerRoutes: meta.ledgerRoutes,
    model: meta.model,
    durations: [...SEEDANCE_DURATIONS],
    resolutions: meta.resolutions,
    aspectRatios: [...SEEDANCE_ASPECT_RATIOS],
    maxReferences: SEEDANCE_MAX_REFERENCE_IMAGES,
    cancelRunning: true,
    audio: true,
    generateAudio: true,
    referenceImages: true,
    referenceVideo: true,
    endFrame: true,
    webhookReady: true,
    uiHint: meta.uiHint,
    providerFamily: "seedance",
    tier,
  };
}

function builtRationale(input, built) {
  return {
    providerSelected: built.tier === "standard" ? "seedance-standard" : "seedance-fast",
    selectionReason: seedanceSelectionRationale(input, built),
    estimatedCost: built.quote.estimatedCost,
    resolution: input.resolution,
    audio: built.audio,
    referenceCount: built.referenceCount,
    mode: built.mode,
    endpointId: built.endpointId,
  };
}

function terminalCost(job, fallback = 0) {
  const value = Number(job.estimated_cost);
  return Number.isFinite(value) ? value : fallback;
}

export function createSeedanceProvider(env = {}, fetchImpl = fetch, options = {}) {
  const tier = seedanceTier(options.tier || options.id);
  const meta = TIER_META[tier];
  return {
    capabilities: capabilitiesFor(tier),
    estimate(input) {
      const built = buildSeedanceRequest({ ...input, provider: meta.id, tier }, env);
      const quote = built.quote;
      return {
        estimatedCost: quote.estimatedCost,
        currency: quote.currency,
        priceBasis: quote.priceBasis || SEEDANCE_PRICE_BASIS,
        ratePerSecond: quote.ratePerSecond,
        rationale: builtRationale(input, built),
      };
    },
    async start(input) {
      requireSeedanceLive(env);
      const built = buildSeedanceRequest({ ...input, provider: meta.id, tier }, env);
      const queued = await falQueueRequest(env, fetchImpl, {
        method: "POST",
        endpointId: built.endpointId,
        kind: "submit",
        body: built.body,
      });
      const requestId = queued.request_id || queued.requestId;
      if (!requestId) {
        throw new ProviderError(
          "INVALID_OPERATION",
          "fal.ai did not return a valid request ID; reconcile before retrying.",
          { uncertain: true },
        );
      }
      try {
        parseFalOperationId(encodeFalOperationId(built.endpointId, requestId));
      } catch {
        throw new ProviderError(
          "INVALID_OPERATION",
          "fal.ai did not return a valid request ID; reconcile before retrying.",
          { uncertain: true },
        );
      }
      return {
        operationId: encodeFalOperationId(built.endpointId, requestId),
        endpointId: built.endpointId,
        requestId,
        mode: built.mode,
        webhook: Boolean(env.SEEDANCE_WEBHOOK_URL),
        rationale: builtRationale(input, built),
      };
    },
    async status(job) {
      requireSeedanceLive(env);
      const { endpointId, requestId } = parseFalOperationId(job.operation_id);
      const current = await falQueueRequest(env, fetchImpl, {
        endpointId,
        requestId,
        kind: "status",
      });
      const status = String(current.status || "").toUpperCase();
      if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
        return { status: "running", queuePosition: current.queue_position ?? null };
      }
      if (status === "FAILED") {
        return {
          status: "failed",
          actualCost: 0,
          costBasis: "provider-failed-no-video",
          error: {
            code: "PROVIDER_FAILED",
            message: "fal.ai reported generation failure.",
            retryable: false,
          },
        };
      }
      if (status && status !== "COMPLETED") {
        throw new ProviderError("INVALID_STATUS", "fal.ai returned an unknown job status.", {
          httpStatus: 502,
        });
      }
      const result = await falQueueRequest(env, fetchImpl, {
        endpointId,
        requestId,
        kind: "result",
      });
      const video = result.video || result.payload?.video;
      const url = video?.url || result.video_url;
      if (!url) {
        return {
          status: "failed",
          actualCost: 0,
          costBasis: "provider-no-video",
          error: {
            code: "NO_OUTPUT",
            message: "fal.ai returned no video (possibly filtered).",
            retryable: false,
          },
        };
      }
      return {
        status: "completed",
        actualCost: terminalCost(job),
        costBasis: "completed-usage-at-quoted-rate",
        asset: {
          url,
          contentType: video?.content_type || "video/mp4",
          fileName: video?.file_name || null,
          fileSize: video?.file_size || null,
          seed: result.seed ?? null,
          requestId,
          endpointId,
          provider: meta.id,
        },
      };
    },
    async cancel(job) {
      requireSeedanceLive(env);
      const { endpointId, requestId } = parseFalOperationId(job.operation_id);
      let queueStatus = "IN_PROGRESS";
      try {
        const current = await falQueueRequest(env, fetchImpl, {
          endpointId,
          requestId,
          kind: "status",
        });
        queueStatus = String(current.status || "IN_PROGRESS").toUpperCase();
      } catch {
        queueStatus = "IN_PROGRESS";
      }
      const result = await falQueueRequest(env, fetchImpl, {
        method: "PUT",
        endpointId,
        requestId,
        kind: "cancel",
      });
      const queued = queueStatus === "IN_QUEUE";
      const waived = queued && result.success !== false;
      return {
        status: "canceled",
        actualCost: waived ? 0 : terminalCost(job),
        costBasis: waived
          ? "seedance-canceled-in-queue-no-charge"
          : "seedance-canceled-at-quoted-rate",
      };
    },
    async asset(job) {
      requireSeedanceLive(env);
      const asset = JSON.parse(job.asset_json || "null");
      if (!asset?.url) fail("INVALID_ASSET", "Stored Seedance output asset is invalid.", 502);
      return downloadFalAsset(fetchImpl, asset.url);
    },
  };
}

export function createSeedanceFastProvider(env, fetchImpl) {
  return createSeedanceProvider(env, fetchImpl, { tier: "fast" });
}

export function createSeedanceStandardProvider(env, fetchImpl) {
  return createSeedanceProvider(env, fetchImpl, { tier: "standard" });
}
