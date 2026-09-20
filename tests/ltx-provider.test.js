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
  LTX_FAST_RATE_PER_SECOND_USD: "0.10",
  LTX_PRO_RATE_PER_SECOND_USD: "0.25",
};

function input(extra = {}) {
  return {
    projectId: "enemies-closer-ep01",
    sceneId: "001",
    shotId: "031",
    provider: "ltx-2.5-fast",
    prompt: "Jasmine protects six-year-old Mikey on the rain-soaked airfield.",
    duration: 6,
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
  assert.equal(fast.estimate(input()).estimatedCost, 0.6);
  assert.equal(pro.estimate(input()).estimatedCost, 1.5);
  validateInput(input(), fast.capabilities);
});

test("LTX pricing must be explicitly configured and live gate is independent", async () => {
  assert.equal(ltxLiveEnabled({ LTX_LIVE_ENABLED: "true" }), true);
  assert.equal(ltxLiveEnabled({ LIVE_RENDERING_ENABLED: "true" }), false);
  assert.throws(
    () => createLtxFastProvider({}).estimate(input()),
    /LTX_FAST_RATE_PER_SECOND_USD must be set/,
  );
  const disabled = createLtxFastProvider({ ...liveEnv, LTX_LIVE_ENABLED: "false" });
  await assert.rejects(disabled.start(input()), /LTX live rendering is disabled/);
});

test("LTX text-to-video sends the official request shape and returns video bytes", async () => {
  const calls = [];
  const provider = createLtxFastProvider(liveEnv, async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response("mp4-fast", { headers: { "content-type": "video/mp4" } });
  });
  const started = await provider.start(input());
  assert.match(started.operationId, /^ltx-sync:/);
  assert.equal(await started.completedResponse.text(), "mp4-fast");
  assert.equal(calls[0].url, "https://api.ltx.video/v1/text-to-video");
  assert.equal(calls[0].init.headers.authorization, "Bearer test-ltx-key");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    prompt: input().prompt,
    model: "ltx-2-5-fast",
    resolution: "1920x1080",
    duration: 6,
    fps: 24,
    generate_audio: true,
  });
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
    if (target.endsWith("/v1/image-to-video"))
      return Response.json({ video_url: "https://cdn.ltx.example/shot-031.mp4" });
    if (target === "https://cdn.ltx.example/shot-031.mp4")
      return new Response("mp4-pro", { headers: { "content-type": "video/mp4" } });
    throw new Error(`Unexpected URL ${target}`);
  });
  const started = await provider.start(input({
    provider: "ltx-2.5-pro",
    referenceImages: [png],
  }));
  assert.equal(await started.completedResponse.text(), "mp4-pro");
  assert.equal(calls[1].init.headers["content-type"], "image/png");
  assert.equal(calls[1].init.headers["x-ms-blob-type"], "BlockBlob");
  const request = JSON.parse(calls[2].init.body);
  assert.equal(request.image_uri, "storage://images/frame-031");
  assert.equal(request.model, "ltx-2-5-pro");
});
