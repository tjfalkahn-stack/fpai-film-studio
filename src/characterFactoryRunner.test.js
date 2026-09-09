import { test } from "node:test";
import assert from "node:assert/strict";
import { createCharacterFactoryPlan } from "./characterFactory.js";
import { runCharacterFactoryPlan } from "./characterFactoryRunner.js";

test("runner retries failed QC and emits character + benchmark manifests", async () => {
  const plan = createCharacterFactoryPlan({
    character: { name: "Marcus", height: "6'2\"", build: "tall lean", wardrobe: ["black suit"] },
    expressions: ["neutral"],
  });
  plan.jobs = plan.jobs.slice(0, 2);
  plan.totals.jobs = 2;

  let starts = 0;
  const executor = {
    estimate: () => ({ estimatedCost: 0.01 }),
    start: async () => ({ operationId: `job-${++starts}` }),
    status: async (id) => ({ status: "completed", asset: { id: `asset-${id}`, contentType: "image/png" } }),
    asset: async () => new Response(new Uint8Array([1,2,3]), { headers: { "content-type": "image/png" } }),
  };
  const seen = new Map();
  const result = await runCharacterFactoryPlan({
    plan,
    executor,
    pollIntervalMs: 0,
    maxAttempts: 2,
    evaluateImage: async ({ job }) => {
      const n = (seen.get(job.id) || 0) + 1;
      seen.set(job.id, n);
      return n === 1
        ? { identity: 0.7, anatomy: 0.9, framing: 0.9, wardrobe: 0.9, artifactFree: 0.9 }
        : { identity: 0.95, anatomy: 0.95, framing: 0.95, wardrobe: 0.95, artifactFree: 0.95 };
    },
    persistAccepted: async ({ job, attemptNumber }) => ({ key: `accepted/${job.taskId}-${attemptNumber}.png` }),
    persistRejected: async ({ job, attemptNumber }) => ({ key: `rejected/${job.taskId}-${attemptNumber}.png` }),
  });

  assert.equal(result.manifest.acceptedJobs, 2);
  assert.equal(result.manifest.totalAttempts, 4);
  assert.equal(result.manifest.rejectCount, 2);
  assert.equal(result.character.acceptedAssets.length, 2);
  assert.equal(result.attempts.filter((a) => !a.accepted).length, 2);
});
