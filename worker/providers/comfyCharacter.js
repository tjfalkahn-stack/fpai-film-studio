import { ProviderError, fail } from "./contract.js";
import {
  cancelPrompt,
  comfyBaseUrl,
  injectWorkflow,
  interpretHistory,
  readHistory,
  requireApiWorkflow,
  submitPrompt,
  uploadInputImage,
  viewOutput,
} from "./comfyNative.js";

async function loadWorkflow(env) {
  if (env.COMFYUI_CHARACTER_WORKFLOW_JSON) {
    try {
      return JSON.parse(env.COMFYUI_CHARACTER_WORKFLOW_JSON);
    } catch {
      fail("PROVIDER_CONFIG", "COMFYUI_CHARACTER_WORKFLOW_JSON is invalid JSON.", 503);
    }
  }
  if (!env.GENERATION_MEDIA) fail("PROVIDER_CONFIG", "Generation media storage is required.", 503);
  const key = env.COMFYUI_CHARACTER_WORKFLOW_KEY || "comfy/workflows/character-still.json";
  const obj = await env.GENERATION_MEDIA.get(key);
  if (!obj) fail("PROVIDER_CONFIG", `Character still workflow missing at ${key}.`, 503);
  return obj.json();
}

function normalizeRate(env) {
  const n = Number(env.COMFYUI_CHARACTER_COST_PER_IMAGE_USD ?? 0);
  if (!Number.isFinite(n) || n < 0)
    fail("PROVIDER_CONFIG", "COMFYUI_CHARACTER_COST_PER_IMAGE_USD must be non-negative.", 503);
  return n;
}

export function createComfyCharacterExecutor(env = {}, fetchImpl = fetch) {
  return {
    capabilities: {
      id: "comfy-character-still",
      label: "ComfyUI · Character Still",
      output: "image",
      mimeTypes: ["image/png", "image/jpeg", "image/webp"],
      paid: normalizeRate(env) > 0,
      model: env.COMFYUI_CHARACTER_WORKFLOW_NAME || "fpai-character-still-v1",
    },
    estimate() {
      return {
        estimatedCost: normalizeRate(env),
        currency: "USD",
        priceBasis: "operator-configured-per-image-rate",
      };
    },
    async start({
      prompt,
      width = 1024,
      height = 1024,
      seed = -1,
      filenamePrefix = "fpai-character",
      referenceImages = [],
    } = {}) {
      comfyBaseUrl(env);
      if (!prompt?.trim()) fail("INVALID_INPUT", "Character prompt is required.", 400);
      const references = await Promise.all(
        (referenceImages || []).map((ref, index) => uploadInputImage(env, fetchImpl, ref, index)),
      );
      const replacements = {
        __FPAI_PROMPT__: prompt,
        __FPAI_WIDTH__: Number(width),
        __FPAI_HEIGHT__: Number(height),
        __FPAI_SEED__: Number(seed),
        __FPAI_FILENAME_PREFIX__: filenamePrefix,
      };
      references.forEach((filename, index) => {
        replacements[`__FPAI_REFERENCE_${index + 1}__`] = filename;
      });
      const workflow = injectWorkflow(
        requireApiWorkflow(await loadWorkflow(env), "Character"),
        replacements,
      );
      const started = await submitPrompt(env, fetchImpl, workflow);
      return { operationId: started.operationId };
    },
    async status(operationId) {
      comfyBaseUrl(env);
      const current = interpretHistory(operationId, await readHistory(env, fetchImpl, operationId), {
        kind: "image",
      });
      if (current.status === "running") return { status: "running" };
      if (current.status === "failed")
        return { status: "failed", error: current.error || { code: "COMFY_JOB_FAILED", message: "Character job failed." } };
      if (current.status !== "completed")
        throw new ProviderError("INVALID_STATUS", "ComfyUI returned an unknown character job status.", {
          httpStatus: 502,
        });
      return { status: "completed", asset: current.asset };
    },
    async asset(assetId) {
      comfyBaseUrl(env);
      return viewOutput(env, fetchImpl, assetId);
    },
    async cancel(operationId) {
      comfyBaseUrl(env);
      await cancelPrompt(env, fetchImpl, operationId);
      return { status: "canceled" };
    },
  };
}
