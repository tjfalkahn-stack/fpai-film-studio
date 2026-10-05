import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { createHiggsfieldProvider } from "../worker/providers/higgsfield.js";
import { makeMp4, makePng } from "./imageFixtures.js";
import { matchProviderDuration } from "../src/referenceVideoClient.js";

const TOKEN = "control";
const requestId = "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff";
const envBase = {
  FPAI_CONTROL_TOKEN: TOKEN,
  HF_CREDENTIALS: "test-id:test-secret",
  HIGGSFIELD_GENJUTSU_720P_RATE_PER_SECOND_USD: "0.681",
  RENDER_PROJECT_ID: "enemies-closer-ep01",
};

function memoryR2() {
  const store = new Map();
  return {
    async put(key, value, options = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      store.set(key, {
        bytes,
        size: bytes.byteLength,
        httpMetadata: options.httpMetadata || {},
        customMetadata: options.customMetadata || {},
      });
    },
    async get(key) {
      const item = store.get(key);
      if (!item) return null;
      return {
        body: item.bytes,
        size: item.size,
        httpMetadata: item.httpMetadata,
        arrayBuffer: async () => item.bytes.slice().buffer,
      };
    },
  };
}

function pngRef(salt) {
  return { mimeType: "image/png", data: makePng(32, 32, { salt }).toString("base64") };
}

function envWithMedia() {
  return { ...envBase, GENERATION_MEDIA: memoryR2() };
}

async function uploadMp4(env, file = new File([makeMp4()], "mascot-motion.mp4", { type: "video/mp4" })) {
  const form = new FormData();
  form.set("file", file);
  form.set("duration", "5");
  return worker.fetch(new Request("https://studio.example/api/reference-videos", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: form,
  }), env);
}

test("matchProviderDuration rounds up into the allowed catalog", () => {
  assert.equal(matchProviderDuration(4.2, [1, 5, 10]), 5);
  assert.equal(matchProviderDuration(5, [4, 5, 6]), 5);
  assert.equal(matchProviderDuration(40, [4, 5, 6]), 6);
});

test("reference MP4 upload requires the owner control token", async () => {
  const env = envWithMedia();
  const form = new FormData();
  form.set("file", new File([makeMp4()], "clip.mp4", { type: "video/mp4" }));
  const response = await worker.fetch(new Request("https://studio.example/api/reference-videos", {
    method: "POST",
    body: form,
  }), env);
  assert.equal(response.status, 401);
});

test("reference upload rejects non-MP4 files without starting generation", async () => {
  const env = envWithMedia();
  const form = new FormData();
  form.set("file", new File([makePng()], "mascot.png", { type: "image/png" }));
  const response = await worker.fetch(new Request("https://studio.example/api/reference-videos", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: form,
  }), env);
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.match(payload.error.message, /MP4/);
  assert.equal(payload.generationStarted, undefined);
});

test("MP4 upload plus two mascot stills returns an estimate-only quote", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("No paid provider calls during quotes"); });
  const env = envWithMedia();
  const uploaded = await uploadMp4(env);
  assert.equal(uploaded.status, 201);
  const video = await uploaded.json();
  assert.equal(video.generationStarted, false);
  assert.match(video.id, /^[a-f0-9-]{36}$/i);
  assert.equal(video.mimeType, "video/mp4");

  const owned = await worker.fetch(new Request(`https://studio.example/api/reference-videos/${video.id}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  }), env);
  assert.equal(owned.status, 200);
  assert.equal(owned.headers.get("content-type"), "video/mp4");

  const mascotA = pngRef("mascot-a");
  const mascotB = pngRef("mascot-b");
  const response = await worker.fetch(new Request("https://studio.example/api/renders", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      projectId: "enemies-closer-ep01",
      sceneId: "CREATE",
      shotId: "DIRECT_PREVIEW",
      provider: "higgsfield-genjutsu-motion",
      prompt: "Two mascots copy the uploaded motion clip.",
      duration: 5,
      resolution: "720p",
      aspectRatio: "16:9",
      estimateOnly: true,
      referenceImages: [mascotA, mascotB],
      referenceVideos: [{ assetId: video.id, mimeType: "video/mp4" }],
    }),
  }), env);
  assert.equal(response.status, 200);
  const quote = await response.json();
  assert.equal(quote.estimatedCost, 3.405);
  assert.equal(quote.debug.referenceImagesTransmitted, 2);
  assert.equal(quote.debug.referenceVideos.length, 1);
  assert.equal(quote.debug.referenceVideos[0].assetId, video.id);
  assert.equal(quote.debug.referenceVideos[0].hasUrl, false);
  assert.doesNotMatch(JSON.stringify(quote), /test-secret|HF_CREDENTIALS/);
});

test("signed reference video URLs are HMAC-gated and used on motion start", async () => {
  const env = envWithMedia();
  const uploaded = await uploadMp4(env);
  const video = await uploaded.json();
  const calls = [];
  const provider = createHiggsfieldProvider(env, async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith("generate-upload-url")) {
      return Response.json({
        upload_url: "https://storage.example.com/upload",
        public_url: "https://cdn.example.com/input.png",
        upload_headers: { "Content-Type": "image/png" },
      });
    }
    if (String(url).includes("storage.example.com")) return new Response(null, { status: 200 });
    return Response.json({ request_id: requestId, status_url: `https://api.higgsfield.ai/requests/${requestId}/status` });
  }, "higgsfield-genjutsu-motion");
  const started = await provider.start({
    prompt: "Follow the mascot motion",
    duration: 5,
    resolution: "720p",
    aspectRatio: "16:9",
    referenceImages: [pngRef("mascot-a"), pngRef("mascot-b")],
    referenceVideos: [{ assetId: video.id, mimeType: "video/mp4" }],
  });
  assert.equal(started.operationId, `https://api.higgsfield.ai/requests/${requestId}/status`);
  const submission = calls.find((call) => String(call.url).includes("genjutsu/motion-transfer"));
  const payload = JSON.parse(submission.init.body);
  assert.equal(payload.image_urls.length, 2);
  assert.match(payload.video_url, /\/api\/reference-videos\//);
  assert.match(payload.video_url, /signature=/);
  const served = await worker.fetch(new Request(payload.video_url), env);
  assert.equal(served.status, 200);
  const tampered = new URL(payload.video_url);
  tampered.searchParams.set("signature", "0".repeat(64));
  const denied = await worker.fetch(new Request(tampered), env);
  assert.equal(denied.status, 404);
});
