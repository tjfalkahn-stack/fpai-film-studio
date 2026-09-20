import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLtxFastProvider,
  createLtxProProvider,
  ltxLiveEnabled,
} from "../worker/providers/ltx.js";
import { validateInput } from "../worker/providers/contract.js";

const png = { mimeType: "image/png", data: "iVBORw0KGgo=" };
const liveEnv = {
  LTX_LIVE_ENABLED: "true",
  LTX_API_KEY: "test-ltx-key",
  LTX_FAST_720P_RATE_PER_SECOND_USD: "0.09",
  LTX_FAST_1080P_RATE_PER_SECOND_USD: "0.13",
  LTX_PRO_720P_RATE_PER_SECOND_USD: "0.12",
  LTX_PRO_1080P_RATE_PER_SECOND_USD: "0.17",
};

function input(extra = {}) {
  return {
    projectId: "enemies-closer-ep01",
    sceneId: "001",
    shotId: "031",
    provider: "ltx-2.5-fast",
    prompt: "Jasmine protects six-year-old Mikey on the rain-soaked airfield.",
    duration: 8,
    resolution: "1080p",
    aspectRatio: "16:9",
    generateAudio: true,
    referenceImages: [],
    ...extra,
  };
}

test("LTX tiers expose exact 2.5 model IDs and operator-priced quotes", () => {
  const fast = createLtxFastProvider(liveEnv);
  const pro = createLtxProProvider(liveEnv);
  assert.equal(fast.capabilities.model, "ltx-2-5-fast");
  assert.equal(pro.capabilities.model, "ltx-2-5-pro");
  assert.equal(fast.capabilities.maxReferences, 1);
  assert.deepEqual(fast.capabilities.durations, [6, 8, 10]);
  assert.equal(fast.estimate(input()).estimatedCost, 1.04);
  assert.equal(pro.estimate(input()).estimatedCost, 1.36);
  validateInput(input(), fast.capabilities);
});

test("LTX pricing must be explicitly configured and live gate is independent", async () => {
  assert.equal(ltxLiveEnabled({ LTX_LIVE_ENABLED: "true" }), true);
  assert.equal(ltxLiveEnabled({ LIVE_RENDERING_ENABLED: "true" }), false);
  assert.throws(
    () => createLtxFastProvider({}).estimate(input()),
    /LTX_FAST_1080P_RATE_PER_SECOND_USD must be set/,
  );
  const disabled = createLtxFastProvider({ ...liveEnv, LTX_LIVE_ENABLED: "false" });
  await assert.rejects(disabled.start(input()), /LTX live rendering is disabled/);
});

test("LTX text-to-video submits and completes through the async production API", async () => {
  const calls = [];
  const provider = createLtxFastProvider(liveEnv, async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/v2/text-to-video") && init.method === "POST")
      return Response.json({ id: "job_text_12345678", created_at: "2026-09-20T00:00:00Z" }, { status: 202 });
    if (String(url).endsWith("/v2/text-to-video/job_text_12345678"))
      return Response.json({ status: "completed", result: { video_url: "https://cdn.ltx.example/text.mp4" } });
    if (String(url) === "https://cdn.ltx.example/text.mp4")
      return new Response("mp4-fast", { headers: { "content-type": "video/mp4" } });
    throw new Error(`Unexpected URL ${url}`);
  });
  const started = await provider.start(input());
  assert.equal(started.operationId, "ltx:v2:text-to-video:job_text_12345678");
  assert.equal(calls[0].url, "https://api.ltx.io/v2/text-to-video");
  assert.equal(calls[0].init.headers.authorization, "Bearer test-ltx-key");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    prompt: input().prompt,
    model: "ltx-2-5-fast",
    resolution: "1920x1080",
    duration: 8,
    fps: 24,
    generate_audio: true,
  });
  const row = { operation_id: started.operationId, estimated_cost: 1.04 };
  const status = await provider.status(row);
  assert.equal(status.status, "completed");
  assert.equal(status.actualCost, 1.04);
  const video = await provider.asset({ asset_json: JSON.stringify(status.asset) });
  assert.equal(await video.text(), "mp4-fast");
});

test("LTX image-to-video uploads one opening frame before generation", async () => {
  const calls = [];
  const provider = createLtxProProvider(liveEnv, async (url, init) => {
    const target = String(url);
    calls.push({ url: target, init });
    if (target.endsWith("/v1/upload"))
      return Response.json({
        upload_url: "https://uploads.ltx.example/frame",
        storage_uri: "storage://images/frame-031",
        required_headers: { "x-ms-blob-type": "BlockBlob" },
      });
    if (target === "https://uploads.ltx.example/frame") return new Response(null, { status: 201 });
    if (target.endsWith("/v2/image-to-video"))
      return Response.json({ id: "job_image_12345678" }, { status: 202 });
    throw new Error(`Unexpected URL ${target}`);
  });
  const started = await provider.start(input({
    provider: "ltx-2.5-pro",
    aspectRatio: "9:16",
    referenceImages: [png],
  }));
  assert.equal(started.operationId, "ltx:v2:image-to-video:job_image_12345678");
  assert.equal(calls[1].init.headers["content-type"], "image/png");
  assert.equal(calls[1].init.headers["x-ms-blob-type"], "BlockBlob");
  const request = JSON.parse(calls[2].init.body);
  assert.equal(request.image_uri, "storage://images/frame-031");
  assert.equal(request.model, "ltx-2-5-pro");
  assert.equal(request.resolution, "1080x1920");
});
