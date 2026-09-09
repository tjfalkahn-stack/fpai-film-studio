import { test } from "node:test";
import assert from "node:assert/strict";
import { createComfyProvider } from "../worker/providers/comfy.js";
import { validateInput } from "../worker/providers/contract.js";

const png = { mimeType: "image/png", data: "iVBORw0KGgo=" };
const input = (extra = {}) => ({
  projectId: "enemies-closer-ep01",
  sceneId: "001",
  shotId: "027",
  provider: "comfy-video",
  prompt: "Marcus hero reveal",
  duration: 6,
  resolution: "720p",
  aspectRatio: "16:9",
  referenceImages: [png],
  continuity: {
    ready: true,
    animaticLocked: true,
    timingApproved: true,
    hasCharacters: true,
  },
  ...extra,
});

function env(extra = {}) {
  return {
    LIVE_RENDERING_ENABLED: "true",
    MOCK_E2E_VERIFIED: "true",
    COMFYUI_BASE_URL: "https://comfy.example/",
    COMFYUI_API_KEY: "comfyui-test",
    COMFYUI_CLIENT_ID: "fpai-studio-test",
    COMFYUI_COST_PER_SECOND_USD: "0.03",
    COMFYUI_WORKFLOW_JSON: JSON.stringify({
      "1": {
        class_type: "FPAITestNode",
        inputs: {
          prompt: "__FPAI_PROMPT__",
          duration: "__FPAI_DURATION__",
          width: "__FPAI_WIDTH__",
          height: "__FPAI_HEIGHT__",
          reference: "__FPAI_REFERENCE_1__",
        },
      },
    }),
    ...extra,
  };
}

const VIDEO_ASSET_ID = new URLSearchParams({
  filename: "film.mp4",
  subfolder: "",
  type: "output",
}).toString();

test("ComfyUI accepts references on 6-second jobs and injects API workflow placeholders", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(new URL(url).origin, "https://comfy.example");
    assert.equal(init.headers.get("authorization"), "Bearer comfyui-test");
    const parsed = new URL(url);
    if (parsed.pathname === "/upload/image") {
      assert.equal(init.method, "POST");
      assert.ok(init.body instanceof FormData);
      assert.equal(init.body.get("type"), "input");
      assert.equal(init.body.get("subfolder"), "fpai");
      assert.equal(init.body.get("overwrite"), "true");
      const file = init.body.get("image");
      assert.ok(file);
      assert.match(file.name, /^fpai-reference-[0-9a-f-]+-1\.png$/);
      return Response.json({ name: file.name, subfolder: "fpai", type: "input" });
    }
    if (parsed.pathname === "/prompt") {
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body);
      assert.equal(body.client_id, "fpai-studio-test");
      const node = body.prompt["1"].inputs;
      assert.equal(node.prompt, "Marcus hero reveal");
      assert.equal(node.duration, 6);
      assert.equal(node.width, 1280);
      assert.equal(node.height, 720);
      assert.match(node.reference, /^fpai\/fpai-reference-[0-9a-f-]+-1\.png$/);
      return Response.json({ prompt_id: "job-123", number: 1, node_errors: {} });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const provider = createComfyProvider(env(), fetchImpl);
  assert.doesNotThrow(() => validateInput(input(), provider.capabilities));
  const started = await provider.start(input());
  assert.equal(started.operationId, "job-123");
  assert.equal(calls.length, 2);
});

test("ComfyUI maps succeeded MP4 output, asset retrieval, quote, and cancel cost", async () => {
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/history/job-123" && init.method !== "POST")
      return Response.json({
        "job-123": {
          status: { status_str: "success", completed: true },
          outputs: {
            "9": {
              gifs: [{ filename: "film.mp4", subfolder: "", type: "output" }],
            },
          },
        },
      });
    if (parsed.pathname === "/queue") return new Response(null, { status: 200 });
    if (parsed.pathname === "/interrupt") return new Response(null, { status: 200 });
    if (parsed.pathname === "/view") {
      assert.equal(parsed.searchParams.get("filename"), "film.mp4");
      assert.equal(parsed.searchParams.get("type"), "output");
      return new Response(new Uint8Array([0, 0, 0, 24]), {
        headers: { "content-type": "video/mp4" },
      });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const provider = createComfyProvider(env(), fetchImpl);
  assert.equal(provider.estimate(input()).estimatedCost, 0.18);
  const job = { operation_id: "job-123", estimated_cost: 0.18 };
  const status = await provider.status(job);
  assert.equal(status.status, "completed");
  assert.equal(status.actualCost, 0.18);
  assert.deepEqual(status.asset, {
    id: VIDEO_ASSET_ID,
    contentType: "video/mp4",
  });
  const bytes = await provider.asset({
    ...job,
    asset_json: JSON.stringify(status.asset),
  });
  assert.equal(bytes.headers.get("content-type"), "video/mp4");
  const canceled = await provider.cancel(job);
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.actualCost, 0.18);
});

test("ComfyUI treats missing history as running", async () => {
  const provider = createComfyProvider(env(), async (url) => {
    if (new URL(url).pathname === "/history/job-123") return Response.json({});
    throw new Error(`Unexpected request ${url}`);
  });
  const status = await provider.status({ operation_id: "job-123", estimated_cost: 0.18 });
  assert.equal(status.status, "running");
});

test("ComfyUI follows signed output redirects without forwarding the API key", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://comfy.example/"))
      return new Response(null, {
        status: 302,
        headers: { location: "https://signed.example/video.mp4?token=one-time" },
      });
    assert.equal(String(url), "https://signed.example/video.mp4?token=one-time");
    assert.equal(init.headers?.get?.("authorization"), undefined);
    return new Response("mp4", { headers: { "content-type": "video/mp4" } });
  };
  const provider = createComfyProvider(env(), fetchImpl);
  const response = await provider.asset({
    asset_json: JSON.stringify({ id: VIDEO_ASSET_ID }),
  });
  assert.equal(await response.text(), "mp4");
  assert.equal(calls.length, 2);
});

test("ComfyUI rejects UI-format workflow JSON before submitting a job", async () => {
  let calls = 0;
  const provider = createComfyProvider(
    env({ COMFYUI_WORKFLOW_JSON: JSON.stringify({ nodes: [], links: [] }) }),
    async () => {
      calls += 1;
      throw new Error("network should not be reached");
    },
  );
  await assert.rejects(
    provider.start(input({ referenceImages: [] })),
    /UI-format JSON is not accepted/,
  );
  assert.equal(calls, 0);
});

test("ComfyUI video start remains behind the live-render gate", async () => {
  const provider = createComfyProvider(
    env({ LIVE_RENDERING_ENABLED: "false" }),
    async () => {
      throw new Error("ComfyUI must not be contacted while live rendering is disabled");
    },
  );
  await assert.rejects(provider.start(input()), /Live rendering is disabled/);
});

test("ambiguous ComfyUI job submission is marked uncertain and not safe to resubmit", async () => {
  const provider = createComfyProvider(
    env(),
    async (url) => {
      if (new URL(url).pathname === "/upload/image")
        return Response.json({ name: "ref.png", subfolder: "fpai", type: "input" });
      throw new Error("connection dropped after submit");
    },
  );
  await assert.rejects(
    provider.start(input()),
    (error) => error.uncertain === true && /do not resubmit/.test(error.message),
  );
});
