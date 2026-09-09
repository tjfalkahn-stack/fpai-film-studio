import { test } from "node:test";
import assert from "node:assert/strict";
import { createComfyCharacterExecutor } from "../worker/providers/comfyCharacter.js";

function env(extra = {}) {
  return {
    COMFYUI_BASE_URL: "https://comfy.example/",
    COMFYUI_API_KEY: "test-key",
    COMFYUI_CHARACTER_COST_PER_IMAGE_USD: "0.02",
    COMFYUI_CHARACTER_WORKFLOW_JSON: JSON.stringify({
      "1": { class_type: "PromptNode", inputs: { prompt: "__FPAI_PROMPT__", width: "__FPAI_WIDTH__", height: "__FPAI_HEIGHT__", seed: "__FPAI_SEED__", prefix: "__FPAI_FILENAME_PREFIX__" } },
    }),
    ...extra,
  };
}

test("character executor injects still workflow and returns image asset", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (path === "/api/v2/jobs" && init.method === "POST") {
      assert.equal(init.headers.get("authorization"), "Bearer test-key");
      const body = JSON.parse(init.body);
      assert.equal(body.workflow["1"].inputs.prompt, "Marcus front portrait");
      assert.equal(body.workflow["1"].inputs.width, 1024);
      return Response.json({ id: "char-job-1", status: "queued" }, { status: 201 });
    }
    if (path === "/api/v2/jobs/char-job-1") {
      return Response.json({ id: "char-job-1", status: "succeeded", outputs: [{ id: "img-1", type: "image", content_type: "image/png" }] });
    }
    if (path === "/api/v2/assets/img-1/content") {
      return new Response(new Uint8Array([1,2,3]), { headers: { "content-type": "image/png" } });
    }
    throw new Error(`unexpected ${url}`);
  };

  const executor = createComfyCharacterExecutor(env(), fetchImpl);
  assert.equal(executor.estimate().estimatedCost, 0.02);
  const started = await executor.start({ prompt: "Marcus front portrait" });
  assert.equal(started.operationId, "char-job-1");
  const status = await executor.status(started.operationId);
  assert.equal(status.status, "completed");
  assert.equal(status.asset.id, "img-1");
  const asset = await executor.asset(status.asset.id);
  assert.equal(asset.headers.get("content-type"), "image/png");
  assert.equal(calls.length, 3);
});
