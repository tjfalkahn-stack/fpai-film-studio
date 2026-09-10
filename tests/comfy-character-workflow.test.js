import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CHARACTER_STILL_CHECKPOINT,
  CHARACTER_STILL_DISK_FOOTPRINT,
  CHARACTER_STILL_IPADAPTER,
  CHARACTER_STILL_MODELS,
  CHARACTER_STILL_STACK_ID,
  selectIdentityReferences,
  weightForReferenceCategory,
} from "../src/characterStillStack.js";
import {
  buildCharacterStillWorkflow,
  describeCharacterStillWorkflow,
} from "../src/characterStillWorkflow.js";

const manifest = JSON.parse(
  fs.readFileSync(new URL("../deploy/runpod-comfyui/models.manifest.json", import.meta.url), "utf8"),
);

test("repo spend gates remain closed", () => {
  const toml = fs.readFileSync(new URL("../wrangler.example.toml", import.meta.url), "utf8");
  assert.match(toml, /CHARACTER_FACTORY_LIVE_ENABLED = "false"/);
  assert.match(toml, /LIVE_RENDERING_ENABLED = "false"/);
});

test("prepared Jasmine first test is one image and is not executable from the repo", () => {
  const packet = JSON.parse(
    fs.readFileSync(new URL("../benchmarks/jasmine.first-test.plan.json", import.meta.url), "utf8"),
  );
  assert.equal(packet.execute, false);
  assert.equal(packet.maxImages, 1);
  assert.equal(packet.plan.jobs.length, 1);
  assert.equal(packet.plan.character.id, "jasmine");
  assert.equal(packet.liveFlagsInThisRepo.CHARACTER_FACTORY_LIVE_ENABLED, "false");
  assert.equal(packet.liveFlagsInThisRepo.LIVE_RENDERING_ENABLED, "false");
});

test("bootstrap manifest matches the Film Studio photoreal stack", () => {
  assert.equal(manifest.stackId, CHARACTER_STILL_STACK_ID);
  assert.equal(manifest.models[0].filename, CHARACTER_STILL_CHECKPOINT);
  assert.equal(manifest.models[2].filename, CHARACTER_STILL_IPADAPTER);
  assert.equal(manifest.disk.modelsApproxGiB, CHARACTER_STILL_DISK_FOOTPRINT.modelsApproxGiB);
  assert.equal(CHARACTER_STILL_MODELS.length, 3);
  assert.ok(CHARACTER_STILL_DISK_FOOTPRINT.modelsApproxGiB > 9);
});

test("workflow builder emits an API-format identity graph with multiple references", () => {
  const workflow = buildCharacterStillWorkflow({
    prompt: "Jasmine identity front, photoreal cinematic",
    negativePrompt: "watermark",
    seed: 42,
    width: 1024,
    height: 1024,
    steps: 30,
    cfg: 6,
    filenamePrefix: "jasmine-angle-identity-front-a1",
    references: [
      { filename: "fpai/jasmine-front.png", category: "identity_anchor" },
      { filename: "fpai/jasmine-profile.png", category: "profile" },
      { filename: "fpai/jasmine-full.png", category: "full_body" },
    ],
  });
  assert.equal(Array.isArray(workflow.nodes), false);
  const summary = describeCharacterStillWorkflow(workflow);
  assert.equal(summary.checkpoint, CHARACTER_STILL_CHECKPOINT);
  assert.equal(summary.referenceCount, 3);
  assert.equal(summary.identityEnabled, true);
  assert.equal(summary.hasSaveImage, true);
  const loaders = Object.values(workflow).filter((node) => node.class_type === "LoadImage");
  assert.deepEqual(
    loaders.map((node) => node.inputs.image),
    ["fpai/jasmine-front.png", "fpai/jasmine-profile.png", "fpai/jasmine-full.png"],
  );
  const sampler = Object.values(workflow).find((node) => node.class_type === "KSampler");
  assert.equal(sampler.inputs.seed, 42);
  assert.equal(sampler.inputs.steps, 30);
  assert.equal(sampler.inputs.cfg, 6);
  const combine = Object.values(workflow).find((node) => node.class_type === "IPAdapterCombineEmbeds");
  assert.equal(combine.inputs.method, "norm average");
});

test("identity references are ranked so anchors reinforce canonical identity", () => {
  const selected = selectIdentityReferences(
    [
      { filename: "a.png", category: "wardrobe" },
      { filename: "b.png", category: "identity_anchor" },
      { filename: "c.png", category: "profile" },
      { filename: "d.png", category: "expression" },
    ],
    3,
  );
  assert.equal(selected[0].category, "identity_anchor");
  assert.equal(selected[1].category, "profile");
  assert.equal(selected[2].category, "wardrobe");
  assert.ok(weightForReferenceCategory("identity_anchor") > weightForReferenceCategory("expression"));
});

test("placeholder export remains API-format and injectible", () => {
  const workflow = buildCharacterStillWorkflow({
    prompt: "x",
    placeholders: true,
    references: [
      { filename: "__FPAI_REFERENCE_1__", category: "identity_anchor" },
      { filename: "__FPAI_REFERENCE_2__", category: "profile" },
    ],
  });
  const flat = JSON.stringify(workflow);
  for (const placeholder of [
    "__FPAI_PROMPT__",
    "__FPAI_NEGATIVE_PROMPT__",
    "__FPAI_WIDTH__",
    "__FPAI_HEIGHT__",
    "__FPAI_SEED__",
    "__FPAI_STEPS__",
    "__FPAI_CFG__",
    "__FPAI_FILENAME_PREFIX__",
    "__FPAI_REFERENCE_1__",
    "__FPAI_REFERENCE_2__",
  ]) {
    assert.ok(flat.includes(placeholder), `missing ${placeholder}`);
  }
});
