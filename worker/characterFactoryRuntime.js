import { runCharacterFactoryPlan } from "../src/characterFactoryRunner.js";
import { CHARACTER_STILL_MAX_REFERENCES } from "../src/characterStillStack.js";
import { createComfyCharacterExecutor } from "./providers/comfyCharacter.js";
import { assertComfyCharacterReady, runComfyCharacterPreflight } from "./providers/comfyPreflight.js";
import { createGeminiCharacterEvaluator } from "./characterQc.js";
import { resolveProviderReferenceImages, selectStoredCharacterReferences } from "./characterReferences.js";

function ext(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function requireEnabled(env) {
  if (env.CHARACTER_FACTORY_LIVE_ENABLED !== "true") {
    throw new Error("Character Factory live execution is disabled.");
  }
  if (!env.GENERATION_MEDIA) throw new Error("GENERATION_MEDIA is required.");
}

function safeSegment(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function planHasReferences(plan) {
  if (plan?.referenceImages?.length) return true;
  return (plan?.jobs || []).some((job) => job.referenceImages?.length);
}

async function resolvePlanReferences(env, plan) {
  if (planHasReferences(plan)) return plan;
  const projectId = plan.projectId || env.RENDER_PROJECT_ID;
  const characterId = plan.character?.id;
  if (!projectId || !characterId || !env.GENERATION_DB) return plan;
  const selection = await selectStoredCharacterReferences(env, {
    projectId,
    characters: [{ id: characterId, name: plan.character?.name }],
    shot: {
      id: "character-factory",
      subject: `${plan.character?.name || characterId} identity reference`,
    },
    providerMaxReferences: CHARACTER_STILL_MAX_REFERENCES,
  });
  const referenceImages = await resolveProviderReferenceImages(
    env,
    projectId,
    selection,
    { id: "comfy-character-still", maxReferences: CHARACTER_STILL_MAX_REFERENCES },
  );
  return {
    ...plan,
    referenceImages,
    characterLock: selection,
    jobs: (plan.jobs || []).map((job) => ({ ...job, referenceImages: job.referenceImages || referenceImages })),
  };
}

export function createCharacterFactoryRuntime(env = {}, fetchImpl = fetch) {
  const executor = createComfyCharacterExecutor(env, fetchImpl);
  const evaluateImage = createGeminiCharacterEvaluator(env, fetchImpl);

  async function persist(kind, { bytes, mimeType, job, plan, attemptNumber, score }) {
    const key = [
      "character-factory",
      safeSegment(plan.character.id),
      kind,
      safeSegment(job.category),
      `${safeSegment(job.taskId)}-attempt-${attemptNumber}.${ext(mimeType)}`,
    ].join("/");
    await env.GENERATION_MEDIA.put(key, bytes, {
      httpMetadata: { contentType: mimeType || "image/png" },
      customMetadata: {
        jobId: String(job.id),
        category: String(job.category),
        taskId: String(job.taskId),
        attemptNumber: String(attemptNumber),
        score: String(score?.score ?? 0),
      },
    });
    return { key, mimeType: mimeType || "image/png" };
  }

  return {
    async preflight(options = {}) {
      return runComfyCharacterPreflight(env, fetchImpl, options);
    },
    async run(plan, options = {}) {
      requireEnabled(env);
      const preflight = await runComfyCharacterPreflight(env, fetchImpl);
      assertComfyCharacterReady(preflight);
      const prepared = await resolvePlanReferences(env, plan);
      if (!planHasReferences(prepared)) {
        throw new Error(
          "Character Factory requires Character Bible reference images before live generation. Upload identity/front, profile, full-body, expression, and wardrobe stills, then retry.",
        );
      }

      const result = await runCharacterFactoryPlan({
        plan: prepared,
        executor,
        evaluateImage,
        persistAccepted: (ctx) => persist("accepted", ctx),
        persistRejected: (ctx) => persist("rejected", ctx),
        maxAttempts: Number(options.maxAttempts ?? env.CHARACTER_FACTORY_MAX_ATTEMPTS ?? 3),
        pollIntervalMs: Number(options.pollIntervalMs ?? env.CHARACTER_FACTORY_POLL_MS ?? 1500),
        width: Number(options.width ?? env.CHARACTER_FACTORY_WIDTH ?? 1024),
        height: Number(options.height ?? env.CHARACTER_FACTORY_HEIGHT ?? 1024),
        steps: Number(options.steps ?? env.CHARACTER_FACTORY_STEPS ?? 30),
        cfg: Number(options.cfg ?? env.CHARACTER_FACTORY_CFG ?? 6),
      });

      const prefix = `character-factory/${safeSegment(prepared.character.id)}`;
      await Promise.all([
        env.GENERATION_MEDIA.put(`${prefix}/character.json`, JSON.stringify(result.character, null, 2), { httpMetadata: { contentType: "application/json" } }),
        env.GENERATION_MEDIA.put(`${prefix}/manifest.json`, JSON.stringify(result.manifest, null, 2), { httpMetadata: { contentType: "application/json" } }),
      ]);
      return { ...result, preflight };
    },
  };
}
