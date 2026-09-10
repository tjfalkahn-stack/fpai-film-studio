import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SEEDANCE_CONTROLLED_TEST, seedancePlanMismatches, seedanceEstimatedCostAllowed } from "../src/seedanceControlledTest.js";

test("first controlled Seedance test is prepared and must not execute", () => {
  const plan = JSON.parse(
    readFileSync(new URL("../benchmarks/enemies-closer.scene-001.seedance.plan.json", import.meta.url), "utf8"),
  );
  assert.equal(plan.execute, false);
  assert.equal(plan.projectId, "enemies-closer-ep01");
  assert.equal(plan.scene.id, "001");
  assert.equal(plan.request.provider, "seedance-fast");
  assert.equal(plan.request.mode, "reference-to-video");
  assert.equal(plan.request.shotId, SEEDANCE_CONTROLLED_TEST.shotId);
  assert.equal(plan.request.endpointId, "bytedance/seedance-2.0/fast/reference-to-video");
  assert.equal(plan.request.referenceCount, 3);
  assert.equal(plan.liveFlagsRequired.SEEDANCE_LIVE_ENABLED, "true");
  assert.equal(plan.liveFlagsRequired.LIVE_RENDERING_ENABLED, undefined);
  assert.equal(plan.liveFlagsRequired.MOCK_E2E_VERIFIED, undefined);
  assert.equal(plan.liveFlagsForbidden, undefined);
  assert.equal(plan.liveFlagsMustStayFalse.LIVE_RENDERING_ENABLED, "false");
  assert.equal(plan.liveFlagsMustStayFalse.MOCK_E2E_VERIFIED, "false");
  assert.equal(plan.liveFlagsInThisRepo.LIVE_RENDERING_ENABLED, "false");
  assert.equal(plan.liveFlagsInThisRepo.MOCK_E2E_VERIFIED, "false");
  assert.equal(plan.liveFlagsInThisRepo.SEEDANCE_LIVE_ENABLED, "false");
  assert.equal(plan.authorization.liveRenderingEnabled, false);
  assert.equal(plan.authorization.mockE2eVerified, "not-used-for-seedance");
  assert.equal(plan.authorization.maxJobs, 1);
  assert.equal(plan.authorization.maxEstimatedCostUsd, 1.46);
  assert.equal(plan.authorization.failClosedAfterFirstJob, true);
  assert.equal(plan.quote.estimatedCost, 1.4514);
  assert.ok(plan.quote.estimatedCost <= 1.46);
  assert.match(plan.concept, /Jasmine moving with young Mikey/);
  assert.equal(plan.blockedUntil.some((item) => item.includes("Worker secret")), true);
  assert.equal(plan.blockedUntil.some((item) => item.includes("LIVE_RENDERING_ENABLED remains false")), true);
  assert.equal(JSON.stringify(plan).includes("test-fal-key"), false);
  assert.equal(/"LIVE_RENDERING_ENABLED"\s*:\s*"true"/.test(JSON.stringify(plan)), false);
  assert.equal(/"MOCK_E2E_VERIFIED"\s*:\s*"true"/.test(JSON.stringify(plan)), false);
});

test("Seedance controlled-test allowlist rejects off-plan inputs and costs above $1.46", () => {
  const allowed = {
    projectId: SEEDANCE_CONTROLLED_TEST.projectId,
    sceneId: SEEDANCE_CONTROLLED_TEST.sceneId,
    shotId: SEEDANCE_CONTROLLED_TEST.shotId,
    provider: SEEDANCE_CONTROLLED_TEST.provider,
    prompt: "Jasmine moving with young Mikey",
    duration: 6,
    resolution: "720p",
    generateAudio: true,
    referenceImages: [
      { mimeType: "image/png", data: "iVBORw0KGgo=" },
      { mimeType: "image/png", data: "iVBORw0KGgo=" },
    ],
  };
  assert.deepEqual(seedancePlanMismatches(allowed), []);
  assert.equal(seedanceEstimatedCostAllowed(1.4514), true);
  assert.equal(seedanceEstimatedCostAllowed(1.46), true);
  assert.equal(seedanceEstimatedCostAllowed(1.4601), false);
  assert.ok(seedancePlanMismatches({ ...allowed, provider: "seedance-standard" }).includes("provider"));
  assert.ok(seedancePlanMismatches({ ...allowed, duration: 8 }).includes("duration"));
  assert.ok(seedancePlanMismatches({ ...allowed, referenceImages: [] }).includes("mode"));
});

test("Seedance authorization source does not read Veo live-render flags", () => {
  const seedance = readFileSync(new URL("../worker/providers/seedance.js", import.meta.url), "utf8");
  const controlled = readFileSync(new URL("../src/seedanceControlledTest.js", import.meta.url), "utf8");
  const docs = readFileSync(new URL("../docs/RENDER_ENGINE_SETUP.md", import.meta.url), "utf8");
  const seedanceDocs = docs.slice(docs.indexOf("## Seedance 2.0"));
  assert.equal(seedance.includes("LIVE_RENDERING_ENABLED"), false);
  assert.equal(seedance.includes("MOCK_E2E_VERIFIED"), false);
  assert.equal(controlled.includes("LIVE_RENDERING_ENABLED"), false);
  assert.equal(controlled.includes("MOCK_E2E_VERIFIED"), false);
  assert.match(controlled, /SEEDANCE_LIVE_ENABLED === "true"/);
  assert.equal(seedanceDocs.includes("all three live flags"), false);
  assert.match(seedanceDocs, /Do not set `MOCK_E2E_VERIFIED=true` to authorize Seedance/);
  assert.match(seedanceDocs, /SEEDANCE_LIVE_ENABLED=true/);
  assert.match(seedanceDocs, /LIVE_RENDERING_ENABLED` must remain `false`/);
});
