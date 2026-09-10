import { createBenchmarkReport, scoreCharacterResult } from "./characterFactory.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runCharacterFactoryPlan({
  plan,
  executor,
  evaluateImage,
  persistAccepted,
  persistRejected,
  maxAttempts = 3,
  pollIntervalMs = 1500,
  width = 1024,
  height = 1024,
  steps,
  cfg,
}) {
  if (!plan?.jobs?.length) throw new Error("Character Factory plan is required.");
  if (!executor?.start || !executor?.status || !executor?.asset) throw new Error("Character executor is required.");
  if (typeof evaluateImage !== "function") throw new Error("evaluateImage callback is required.");
  const attempts = [];

  for (const job of plan.jobs) {
    let accepted = false;
    for (let attemptNumber = 1; attemptNumber <= maxAttempts && !accepted; attemptNumber += 1) {
      const startedAt = Date.now();
      const quote = executor.estimate?.({ job, plan }) || { estimatedCost: 0 };
      const start = await executor.start({
        prompt: job.prompt,
        negativePrompt: job.negativePrompt || plan.negativePrompt,
        width,
        height,
        seed: job.seed ?? plan.seed ?? -1,
        steps,
        cfg,
        filenamePrefix: `${plan.character.id}-${job.category}-${job.taskId}-a${attemptNumber}`,
        referenceImages: job.referenceImages || plan.referenceImages || [],
      });

      let state;
      for (;;) {
        state = await executor.status(start.operationId);
        if (state.status !== "running") break;
        await sleep(pollIntervalMs);
      }

      const computeSeconds = (Date.now() - startedAt) / 1000;
      if (state.status !== "completed") {
        attempts.push({
          jobId: job.id,
          attemptNumber,
          accepted: false,
          computeSeconds,
          costUsd: Number(quote.estimatedCost || 0),
          error: state.error || { code: "GENERATION_FAILED", message: "Character generation failed." },
        });
        continue;
      }

      const response = await executor.asset(state.asset.id);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const evaluation = await evaluateImage({
        bytes,
        mimeType: state.asset.contentType || response.headers.get("content-type") || "image/png",
        job,
        plan,
        attemptNumber,
      });
      const score = scoreCharacterResult(evaluation.metrics || evaluation);
      const record = {
        jobId: job.id,
        attemptNumber,
        accepted: score.pass,
        score,
        computeSeconds,
        costUsd: Number(quote.estimatedCost || 0),
        asset: null,
      };

      if (score.pass) {
        const asset = await persistAccepted?.({ bytes, mimeType: state.asset.contentType, job, plan, attemptNumber, score });
        record.asset = asset || { providerAssetId: state.asset.id };
        accepted = true;
      } else {
        const asset = await persistRejected?.({ bytes, mimeType: state.asset.contentType, job, plan, attemptNumber, score });
        record.rejectedAsset = asset || { providerAssetId: state.asset.id };
      }
      attempts.push(record);
    }
  }

  const report = createBenchmarkReport(plan, attempts);
  const acceptedAssets = attempts.filter((a) => a.accepted).map((a) => ({ jobId: a.jobId, asset: a.asset, score: a.score }));
  const character = {
    schema: "fpai.character.v1",
    generatedAt: new Date().toISOString(),
    factoryVersion: plan.version,
    character: plan.character,
    medium: plan.medium,
    acceptedAssets,
    ready: report.ready,
  };
  const manifest = {
    ...report,
    schema: "fpai.character-factory.manifest.v1",
    generatedAt: new Date().toISOString(),
    planTotals: plan.totals,
  };

  return { character, manifest, attempts };
}
