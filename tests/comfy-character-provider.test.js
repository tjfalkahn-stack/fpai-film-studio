import { test } from "node:test";
import assert from "node:assert/strict";
import { createComfyCharacterExecutor } from "../worker/providers/comfyCharacter.js";
import { CHARACTER_STILL_CHECKPOINT } from "../src/characterStillStack.js";
import { createComfyFetchMock, PREFLIGHT_PNG } from "./comfyFixtures.js";

const png = { mimeType: "image/png", data: "iVBORw0KGgo=" };
const IMAGE_ASSET_ID = new URLSearchParams({
  filename: "marcus.png",
  subfolder: "",
  type: "output",
}).toString();

function env(extra = {}) {
  return {
    COMFYUI_BASE_URL: "https://comfy.example/",
    COMFYUI_API_KEY: "test-key",
    COMFYUI_CLIENT_ID: "fpai-character-test",
    COMFYUI_CHARACTER_COST_PER_IMAGE_USD: "0.02",
    COMFYUI_CHARACTER_WORKFLOW_JSON: JSON.stringify({
      "1": {
        class_type: "PromptNode",
        inputs: {
          prompt: "__FPAI_PROMPT__",
          width: "__FPAI_WIDTH__",
          height: "__FPAI_HEIGHT__",
          seed: "__FPAI_SEED__",
          prefix: "__FPAI_FILENAME_PREFIX__",
          reference: "__FPAI_REFERENCE_1__",
        },
      },
    }),
    ...extra,
  };
}

test("character executor injects still workflow and returns image asset", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const parsed = new URL(url);
    if (parsed.pathname === "/prompt" && init.method === "POST") {
      assert.equal(init.headers.get("authorization"), "Bearer test-key");
      const body = JSON.parse(init.body);
      assert.equal(body.client_id, "fpai-character-test");
      assert.equal(body.prompt["1"].inputs.prompt, "Marcus front portrait");
      assert.equal(body.prompt["1"].inputs.width, 1024);
      assert.equal(body.prompt["1"].inputs.reference, "__FPAI_REFERENCE_1__");
      return Response.json({ prompt_id: "char-job-1", number: 1, node_errors: {} });
    }
    if (parsed.pathname === "/history/char-job-1") {
      return Response.json({
        "char-job-1": {
          status: { status_str: "success", completed: true },
          outputs: {
            "7": { images: [{ filename: "marcus.png", subfolder: "", type: "output" }] },
          },
        },
      });
    }
    if (parsed.pathname === "/view") {
      assert.equal(parsed.searchParams.get("filename"), "marcus.png");
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    }
    throw new Error(`unexpected ${url}`);
  };

  const executor = createComfyCharacterExecutor(env(), fetchImpl);
  assert.equal(executor.estimate().estimatedCost, 0.02);
  const started = await executor.start({ prompt: "Marcus front portrait" });
  assert.equal(started.operationId, "char-job-1");
  const status = await executor.status(started.operationId);
  assert.equal(status.status, "completed");
  assert.equal(status.asset.id, IMAGE_ASSET_ID);
  assert.equal(status.asset.contentType, "image/png");
  const asset = await executor.asset(status.asset.id);
  assert.equal(asset.headers.get("content-type"), "image/png");
  assert.equal(calls.length, 3);
});

test("character executor uploads identity references into native Comfy input", async () => {
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/upload/image") {
      assert.equal(init.body.get("subfolder"), "fpai");
      const file = init.body.get("image");
      return Response.json({ name: file.name, subfolder: "fpai", type: "input" });
    }
    if (parsed.pathname === "/prompt") {
      const body = JSON.parse(init.body);
      assert.match(body.prompt["1"].inputs.reference, /^fpai\/fpai-reference-[0-9a-f-]+-1\.png$/);
      return Response.json({ prompt_id: "char-job-ref", number: 1, node_errors: {} });
    }
    throw new Error(`unexpected ${url}`);
  };
  const executor = createComfyCharacterExecutor(env(), fetchImpl);
  const started = await executor.start({ prompt: "Marcus front portrait", referenceImages: [png] });
  assert.equal(started.operationId, "char-job-ref");
});

test("character executor does not require the video live-render gate", async () => {
  const executor = createComfyCharacterExecutor(
    env({ LIVE_RENDERING_ENABLED: "false", MOCK_E2E_VERIFIED: "false" }),
    async (url) => {
      if (new URL(url).pathname === "/prompt")
        return Response.json({ prompt_id: "char-job-gated", number: 1, node_errors: {} });
      throw new Error(`unexpected ${url}`);
    },
  );
  const started = await executor.start({ prompt: "Marcus front portrait" });
  assert.equal(started.operationId, "char-job-gated");
});

test("native FPAI workflow injects multiple Character Bible references into LoadImage nodes", async () => {
  let submitted;
  const { fetchImpl } = createComfyFetchMock({
    promptId: "native-job",
    inspectPrompt: (body) => {
      submitted = body;
    },
  });
  const executor = createComfyCharacterExecutor(
    {
      COMFYUI_BASE_URL: "https://comfy.example/",
      COMFYUI_CLIENT_ID: "fpai-character-test",
      COMFYUI_CHARACTER_COST_PER_IMAGE_USD: "0",
    },
    fetchImpl,
  );
  const started = await executor.start({
    prompt: "Jasmine identity front",
    negativePrompt: "watermark",
    seed: 7,
    steps: 28,
    cfg: 5.5,
    filenamePrefix: "jasmine-angle-identity-front-a1",
    referenceImages: [
      { ...PREFLIGHT_PNG, category: "identity_anchor" },
      { ...PREFLIGHT_PNG, category: "profile" },
      { ...PREFLIGHT_PNG, category: "full_body" },
    ],
  });
  assert.equal(started.operationId, "native-job");
  const nodes = Object.values(submitted.prompt);
  assert.ok(nodes.every((node) => node.class_type !== undefined));
  assert.equal(nodes.find((node) => node.class_type === "CheckpointLoaderSimple").inputs.ckpt_name, CHARACTER_STILL_CHECKPOINT);
  const loaders = nodes.filter((node) => node.class_type === "LoadImage");
  assert.equal(loaders.length, 3);
  assert.ok(loaders.every((node) => String(node.inputs.image).startsWith("fpai/")));
  const sampler = nodes.find((node) => node.class_type === "KSampler");
  assert.equal(sampler.inputs.seed, 7);
  assert.equal(sampler.inputs.steps, 28);
  assert.equal(sampler.inputs.cfg, 5.5);
  assert.equal(nodes.find((node) => node.class_type === "SaveImage").inputs.filename_prefix, "jasmine-angle-identity-front-a1");
});

test("character executor surfaces Comfy execution failure without inventing an image", async () => {
  const { fetchImpl } = createComfyFetchMock({ promptId: "boom", failHistory: true });
  const executor = createComfyCharacterExecutor(
    {
      COMFYUI_BASE_URL: "https://comfy.example/",
      COMFYUI_CHARACTER_WORKFLOW_JSON: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { prompt: "__FPAI_PROMPT__" } } }),
    },
    fetchImpl,
  );
  const started = await executor.start({ prompt: "Jasmine" });
  const status = await executor.status(started.operationId);
  assert.equal(status.status, "failed");
  assert.match(status.error.message, /CUDA OOM/);
});

test("character executor does not treat a missing download as a completed still", async () => {
  const { fetchImpl } = createComfyFetchMock({ promptId: "view-fail", failView: true, outputFile: "jasmine.png" });
  const executor = createComfyCharacterExecutor(
    {
      COMFYUI_BASE_URL: "https://comfy.example/",
      COMFYUI_CHARACTER_WORKFLOW_JSON: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { prompt: "__FPAI_PROMPT__" } } }),
    },
    fetchImpl,
  );
  await executor.start({ prompt: "Jasmine" });
  const status = await executor.status("view-fail");
  assert.equal(status.status, "completed");
  await assert.rejects(() => executor.asset(status.asset.id), /download failed|ASSET_RETRY|HTTP 404|could not be reached/i);
});
