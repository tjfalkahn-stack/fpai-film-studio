import { test } from "node:test";
import assert from "node:assert/strict";
import { createCharacterFactoryRuntime } from "../worker/characterFactoryRuntime.js";
import { createCharacterFactoryPlan, createCharacterFactorySmokePlan } from "../src/characterFactory.js";
import { runCharacterFactoryPlan } from "../src/characterFactoryRunner.js";
import { createComfyFetchMock, PREFLIGHT_PNG } from "./comfyFixtures.js";

test("Character Factory runtime refuses to run when live execution is disabled", async () => {
  const runtime = createCharacterFactoryRuntime({ CHARACTER_FACTORY_LIVE_ENABLED: "false" });
  await assert.rejects(runtime.run({ jobs: [{}] }), /Character Factory live execution is disabled/);
});

test("Character Factory runtime refuses a live run when Comfy preflight is incomplete", async () => {
  const { fetchImpl } = createComfyFetchMock({ missingCheckpoint: true });
  const runtime = createCharacterFactoryRuntime(
    {
      CHARACTER_FACTORY_LIVE_ENABLED: "true",
      GENERATION_MEDIA: { put() {}, get() { return null; } },
      COMFYUI_BASE_URL: "https://comfy.example/",
    },
    fetchImpl,
  );
  const plan = createCharacterFactorySmokePlan({
    character: { name: "Jasmine", wardrobe: ["Tarmac Look 01"] },
    referenceImages: [PREFLIGHT_PNG],
  });
  await assert.rejects(runtime.run(plan), /incomplete|RealVisXL/i);
});

test("Character Factory runtime refuses a live run without Character Bible references", async () => {
  const { fetchImpl } = createComfyFetchMock();
  const runtime = createCharacterFactoryRuntime(
    {
      CHARACTER_FACTORY_LIVE_ENABLED: "true",
      GENERATION_MEDIA: { put() {}, get() { return null; } },
      COMFYUI_BASE_URL: "https://comfy.example/",
    },
    fetchImpl,
  );
  const plan = createCharacterFactorySmokePlan({
    character: { name: "Jasmine", wardrobe: ["Tarmac Look 01"] },
  });
  await assert.rejects(runtime.run(plan), /Character Bible reference images/);
});

test("runner forwards plan reference images, sampler settings, and negative prompt", async () => {
  const plan = createCharacterFactoryPlan({
    character: { name: "Marcus", height: "6'2\"", build: "tall lean", wardrobe: ["black suit"] },
    expressions: ["neutral"],
  });
  plan.jobs = plan.jobs.slice(0, 1);
  plan.totals.jobs = 1;
  plan.negativePrompt = "watermark";
  plan.referenceImages = [{ mimeType: "image/png", data: "iVBORw0KGgo=", category: "identity_anchor" }];

  let received;
  const result = await runCharacterFactoryPlan({
    plan,
    pollIntervalMs: 0,
    maxAttempts: 1,
    steps: 28,
    cfg: 5.5,
    executor: {
      estimate: () => ({ estimatedCost: 0.01 }),
      start: async (input) => {
        received = input;
        return { operationId: "job-1" };
      },
      status: async () => ({ status: "completed", asset: { id: "filename=out.png&subfolder=&type=output", contentType: "image/png" } }),
      asset: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
    },
    evaluateImage: async () => ({ identity: 0.95, anatomy: 0.95, framing: 0.95, wardrobe: 0.95, artifactFree: 0.95 }),
    persistAccepted: async () => ({ key: "accepted/front.png" }),
  });

  assert.equal(received.prompt.includes("Marcus"), true);
  assert.equal(received.negativePrompt, "watermark");
  assert.equal(received.steps, 28);
  assert.equal(received.cfg, 5.5);
  assert.equal(received.referenceImages.length, 1);
  assert.equal(result.manifest.acceptedJobs, 1);
});
