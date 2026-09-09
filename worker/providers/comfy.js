import { ProviderError, fail } from "./contract.js";
import {
  cancelPrompt,
  injectWorkflow,
  interpretHistory,
  readHistory,
  requireApiWorkflow,
  requireLiveRendering,
  submitPrompt,
  uploadInputImage,
  viewOutput,
} from "./comfyNative.js";

const DEFAULT_WORKFLOW_KEY = "comfy/workflows/video.json";
const DEFAULT_MODEL = "comfyui-api-workflow-v2";

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
      requireLiveRendering(env);
      const references = await Promise.all(
        (input.referenceImages || []).map((ref, index) =>
          uploadInputImage(env, fetchImpl, ref, index),
        ),
      );
      const [width, height] = dimensions(input.resolution, input.aspectRatio);
      const replacements = {
        __FPAI_PROMPT__: input.prompt,
        __FPAI_DURATION__: input.duration,
        __FPAI_ASPECT_RATIO__: input.aspectRatio,
        __FPAI_WIDTH__: width,
        __FPAI_HEIGHT__: height,
      };
      references.forEach((filename, index) => {
        replacements[`__FPAI_REFERENCE_${index + 1}__`] = filename;
      });
      const workflow = injectWorkflow(requireApiWorkflow(await loadWorkflow(env)), replacements);
      const started = await submitPrompt(env, fetchImpl, workflow);
      return { operationId: started.operationId };
    },
    async status(job) {
      requireLiveRendering(env);
      if (!job.operation_id) fail("INVALID_OPERATION", "Stored ComfyUI job ID is missing.");
      const current = interpretHistory(job.operation_id, await readHistory(env, fetchImpl, job.operation_id), {
        kind: "video",
      });
      if (current.status === "running") return { status: "running" };
      if (current.status === "failed")
        return {
          status: "failed",
          actualCost: terminalCost(job),
          costBasis:
            current.error?.code === "NO_VIDEO_OUTPUT"
              ? "comfy-completed-no-video-at-configured-rate"
              : current.error?.code === "UNSUPPORTED_OUTPUT"
                ? "comfy-completed-unsupported-output-at-configured-rate"
                : "comfy-terminal-usage-at-configured-rate",
          error: current.error,
        };
      if (current.status !== "completed")
        throw new ProviderError("INVALID_STATUS", "ComfyUI returned an unknown job status.", {
          httpStatus: 502,
        });
      return {
        status: "completed",
        actualCost: terminalCost(job),
        costBasis: "comfy-completed-at-configured-rate",
        asset: current.asset,
      };
    },
    async cancel(job) {
      requireLiveRendering(env);
      if (!job.operation_id) fail("INVALID_OPERATION", "Stored ComfyUI job ID is missing.");
      await cancelPrompt(env, fetchImpl, job.operation_id);
      return {
        status: "canceled",
        actualCost: terminalCost(job),
        costBasis: "comfy-canceled-at-configured-rate",
      };
    },
    async asset(job) {
      requireLiveRendering(env);
      const asset = JSON.parse(job.asset_json || "null");
      if (!asset?.id) fail("INVALID_ASSET", "Stored ComfyUI output asset is invalid.", 502);
      return viewOutput(env, fetchImpl, asset.id);
    },
  };
}
