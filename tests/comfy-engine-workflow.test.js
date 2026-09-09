import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = new URL("../deploy/comfy-engine/workflows/character-still-sdxl-api.json", import.meta.url);

function values(value) {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") return Object.values(value).flatMap(values);
  return [value];
}

test("packaged Comfy character workflow is API-format and injectible", () => {
  const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  assert.equal(Array.isArray(workflow.nodes), false);
  assert.equal(Array.isArray(workflow.links), false);
  assert.ok(Object.keys(workflow).length >= 7);
  const flat = values(workflow);
  for (const placeholder of [
    "__FPAI_PROMPT__",
    "__FPAI_WIDTH__",
    "__FPAI_HEIGHT__",
    "__FPAI_SEED__",
    "__FPAI_FILENAME_PREFIX__",
  ]) {
    assert.ok(flat.includes(placeholder), `missing ${placeholder}`);
  }
  assert.ok(Object.values(workflow).some((node) => node.class_type === "CheckpointLoaderSimple"));
  assert.ok(Object.values(workflow).some((node) => node.class_type === "SaveImage"));
});
