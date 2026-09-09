import { runCharacterFactoryPlan } from "../src/characterFactoryRunner.js";
import { createComfyCharacterExecutor } from "./providers/comfyCharacter.js";
import { createGeminiCharacterEvaluator } from "./characterQc.js";

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
    async run(plan, options = {}) {
      requireEnabled(env);
      const result = await runCharacterFactoryPlan({
        plan,
        executor,
        evaluateImage,
        persistAccepted: (ctx) => persist("accepted", ctx),
        persistRejected: (ctx) => persist("rejected", ctx),
        maxAttempts: Number(options.maxAttempts ?? env.CHARACTER_FACTORY_MAX_ATTEMPTS ?? 3),
        pollIntervalMs: Number(options.pollIntervalMs ?? env.CHARACTER_FACTORY_POLL_MS ?? 1500),
        width: Number(options.width ?? env.CHARACTER_FACTORY_WIDTH ?? 1024),
        height: Number(options.height ?? env.CHARACTER_FACTORY_HEIGHT ?? 1024),
      });

      const prefix = `character-factory/${safeSegment(plan.character.id)}`;
      await Promise.all([
        env.GENERATION_MEDIA.put(`${prefix}/character.json`, JSON.stringify(result.character, null, 2), { httpMetadata: { contentType: "application/json" } }),
        env.GENERATION_MEDIA.put(`${prefix}/manifest.json`, JSON.stringify(result.manifest, null, 2), { httpMetadata: { contentType: "application/json" } }),
      ]);
      return result;
    },
  };
}
