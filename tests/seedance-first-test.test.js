import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("first controlled Seedance test is prepared and must not execute", () => {
  const plan = JSON.parse(
    readFileSync(new URL("../benchmarks/enemies-closer.scene-001.seedance.plan.json", import.meta.url), "utf8"),
  );
  assert.equal(plan.execute, false);
  assert.equal(plan.projectId, "enemies-closer-ep01");
  assert.equal(plan.scene.id, "001");
  assert.equal(plan.request.provider, "seedance-fast");
  assert.equal(plan.request.mode, "reference-to-video");
  assert.equal(plan.request.endpointId, "bytedance/seedance-2.0/fast/reference-to-video");
  assert.equal(plan.request.referenceCount, 3);
  assert.equal(plan.liveFlagsInThisRepo.LIVE_RENDERING_ENABLED, "false");
  assert.equal(plan.liveFlagsInThisRepo.SEEDANCE_LIVE_ENABLED, "false");
  assert.equal(plan.quote.estimatedCost, 1.4514);
  assert.match(plan.concept, /Jasmine moving with young Mikey/);
  assert.equal(plan.blockedUntil.some((item) => item.includes("Worker secret")), true);
  assert.equal(JSON.stringify(plan).includes("test-fal-key"), false);
});
