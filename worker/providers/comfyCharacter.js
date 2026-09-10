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
import {
  CHARACTER_STILL_DEFAULT_CFG,
  CHARACTER_STILL_DEFAULT_HEIGHT,
  CHARACTER_STILL_DEFAULT_NEGATIVE_PROMPT,
  CHARACTER_STILL_DEFAULT_STEPS,
  CHARACTER_STILL_DEFAULT_WIDTH,
  CHARACTER_STILL_MAX_REFERENCES,
  CHARACTER_STILL_STACK_ID,
  CHARACTER_STILL_STACK_LABEL,
  selectIdentityReferences,
} from "../../src/characterStillStack.js";
import { buildCharacterStillWorkflow } from "../../src/characterStillWorkflow.js";
import { runComfyCharacterPreflight } from "./comfyPreflight.js";

async function loadOverrideWorkflow(env) {
  if (env.COMFYUI_CHARACTER_WORKFLOW_JSON) {
    try {
      return JSON.parse(env.COMFYUI_CHARACTER_WORKFLOW_JSON);
    } catch {
      fail("PROVIDER_CONFIG", "COMFYUI_CHARACTER_WORKFLOW_JSON is invalid JSON.", 503);
    }
  }
  if (!env.COMFYUI_CHARACTER_WORKFLOW_KEY) return null;
  if (!env.GENERATION_MEDIA) fail("PROVIDER_CONFIG", "Generation media storage is required.", 503);
  const key = env.COMFYUI_CHARACTER_WORKFLOW_KEY;
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

function samplerSettings(env, input = {}) {
  const steps = Number(input.steps ?? env.CHARACTER_FACTORY_STEPS ?? CHARACTER_STILL_DEFAULT_STEPS);
  const cfg = Number(input.cfg ?? input.guidance ?? env.CHARACTER_FACTORY_CFG ?? CHARACTER_STILL_DEFAULT_CFG);
  if (!Number.isFinite(steps) || steps < 1 || steps > 80)
    fail("INVALID_INPUT", "Character steps must be between 1 and 80.", 400);
  if (!Number.isFinite(cfg) || cfg <= 0 || cfg > 30)
    fail("INVALID_INPUT", "Character CFG/guidance must be between 0 and 30.", 400);
  return { steps, cfg };
}

export function createComfyCharacterExecutor(env = {}, fetchImpl = fetch) {
  return {
    capabilities: {
      id: "comfy-character-still",
      label: "ComfyUI · Character Still",
      output: "image",
      mimeTypes: ["image/png", "image/jpeg", "image/webp"],
      paid: normalizeRate(env) > 0,
      model: env.COMFYUI_CHARACTER_WORKFLOW_NAME || CHARACTER_STILL_STACK_LABEL,
      stackId: CHARACTER_STILL_STACK_ID,
      maxReferences: CHARACTER_STILL_MAX_REFERENCES,
    },
    estimate() {
      return {
        estimatedCost: normalizeRate(env),
        currency: "USD",
        priceBasis: "operator-configured-per-image-rate",
      };
    },
    async preflight(options = {}) {
      return runComfyCharacterPreflight(env, fetchImpl, options);
    },
    async start({
      prompt,
      negativePrompt = CHARACTER_STILL_DEFAULT_NEGATIVE_PROMPT,
      width = CHARACTER_STILL_DEFAULT_WIDTH,
      height = CHARACTER_STILL_DEFAULT_HEIGHT,
      seed = -1,
      steps,
      cfg,
      filenamePrefix = "fpai-character",
      referenceImages = [],
    } = {}) {
      comfyBaseUrl(env);
      if (!prompt?.trim()) fail("INVALID_INPUT", "Character prompt is required.", 400);
      const selected = selectIdentityReferences(referenceImages, CHARACTER_STILL_MAX_REFERENCES);
      const uploads = await Promise.all(
        selected.map(async (ref, index) => {
          const filename = await uploadInputImage(env, fetchImpl, ref, index);
          return { ...ref, filename };
        }),
      );
      const sampler = samplerSettings(env, { steps, cfg });
      const override = await loadOverrideWorkflow(env);
      let workflow;
      if (override) {
        const replacements = {
          __FPAI_PROMPT__: prompt,
          __FPAI_NEGATIVE_PROMPT__: negativePrompt || CHARACTER_STILL_DEFAULT_NEGATIVE_PROMPT,
          __FPAI_WIDTH__: Number(width),
          __FPAI_HEIGHT__: Number(height),
          __FPAI_SEED__: Number(seed),
          __FPAI_STEPS__: sampler.steps,
          __FPAI_CFG__: sampler.cfg,
          __FPAI_FILENAME_PREFIX__: filenamePrefix,
        };
        uploads.forEach((ref, index) => {
          replacements[`__FPAI_REFERENCE_${index + 1}__`] = ref.filename;
        });
        workflow = injectWorkflow(requireApiWorkflow(override, "Character"), replacements);
      } else {
        workflow = requireApiWorkflow(
          buildCharacterStillWorkflow({
            prompt,
            negativePrompt: negativePrompt || CHARACTER_STILL_DEFAULT_NEGATIVE_PROMPT,
            seed,
            width,
            height,
            steps: sampler.steps,
            cfg: sampler.cfg,
            filenamePrefix,
            references: uploads,
          }),
          "Character",
        );
      }
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
