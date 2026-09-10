import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildCharacterStillWorkflow } from "../src/characterStillWorkflow.js";
import { CHARACTER_STILL_CHECKPOINT } from "../src/characterStillStack.js";

const legacyPath = new URL("../deploy/comfy-engine/workflows/character-still-sdxl-api.json", import.meta.url);
const photorealPath = new URL("../deploy/runpod-comfyui/workflows/character-still-photoreal-api.json", import.meta.url);

function values(value) {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") return Object.values(value).flatMap(values);
  return [value];
}

test("legacy packaged SDXL workflow remains API-format", () => {
  const workflow = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  assert.equal(Array.isArray(workflow.nodes), false);
  assert.ok(Object.values(workflow).some((node) => node.class_type === "CheckpointLoaderSimple"));
  assert.ok(Object.values(workflow).some((node) => node.class_type === "SaveImage"));
});

test("owned photoreal character workflow is API-format with identity placeholders", () => {
  const workflow = JSON.parse(fs.readFileSync(photorealPath, "utf8"));
  assert.equal(Array.isArray(workflow.nodes), false);
  assert.equal(Array.isArray(workflow.links), false);
  const flat = values(workflow);
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
  ]) {
    assert.ok(flat.includes(placeholder), `missing ${placeholder}`);
  }
  assert.equal(
    Object.values(workflow).find((node) => node.class_type === "CheckpointLoaderSimple").inputs.ckpt_name,
    CHARACTER_STILL_CHECKPOINT,
  );
  assert.ok(Object.values(workflow).some((node) => node.class_type === "IPAdapterEmbeds"));
  assert.ok(Object.values(workflow).some((node) => node.class_type === "LoadImage"));
  assert.deepEqual(workflow, buildCharacterStillWorkflow({
    prompt: "x",
    placeholders: true,
    references: [
      { filename: "__FPAI_REFERENCE_1__", category: "identity_anchor" },
      { filename: "__FPAI_REFERENCE_2__", category: "profile" },
      { filename: "__FPAI_REFERENCE_3__", category: "full_body" },
    ],
  }));
});
