import test from "node:test";
import assert from "node:assert/strict";
import { createVeoProvider } from "../worker/providers/veo.js";

const env = { LIVE_RENDERING_ENABLED: "true", MOCK_E2E_VERIFIED: "true", GEMINI_API_KEY: "test-secret" };
const reference = { mimeType: "image/png", data: "iVBORw0KGgo=" };
const input = { projectId: "enemies-closer", prompt: "Cinema. Marcus turns toward the door.", duration: 8, resolution: "1080p", aspectRatio: "16:9", referenceImages: [reference] };

test("Enemies Closer explicit start-frame mode animates the composed still", async () => {
  let payload;
  const provider = createVeoProvider(env, async (_url, init) => {
    payload = JSON.parse(init.body);
    return Response.json({ name: "models/veo-3.1-fast-generate-preview/operations/example" });
  });
  await provider.start({ ...input, referenceMode: "start-frame" });
  assert.deepEqual(payload.instances[0].image, { inlineData: reference });
  assert.equal(payload.instances[0].referenceImages, undefined);
  assert.equal(payload.parameters.personGeneration, "allow_adult");
});

test("character reference mode preserves multiple references without making one the opening frame", async () => {
  let payload;
  const provider = createVeoProvider(env, async (_url, init) => {
    payload = JSON.parse(init.body);
    return Response.json({ name: "models/veo-3.1-fast-generate-preview/operations/example" });
  });
  await provider.start({ ...input, referenceMode: "reference-images", referenceImages: [reference, reference] });
  assert.equal(payload.instances[0].image, undefined);
  assert.equal(payload.instances[0].referenceImages.length, 2);
});

test("invalid start-frame selections never reach Google", async () => {
  let calls = 0;
  const provider = createVeoProvider(env, async () => { calls++; });
  for (const referenceImages of [[], [reference, reference]]) {
    await assert.rejects(provider.start({ ...input, referenceMode: "start-frame", referenceImages }), /exactly one/);
  }
  await assert.rejects(provider.start({ ...input, referenceMode: "unknown" }), /Unsupported/);
  assert.equal(calls, 0);
});

test("quota errors are actionable and raw Google messages never expose credentials", async () => {
  const provider = createVeoProvider(env, async () => Response.json({ error: { message: "test-secret" } }, { status: 429 }));
  await assert.rejects(provider.start(input), (error) => error.code === "PROVIDER_HTTP" && /quota/.test(error.message) && !error.message.includes("test-secret") && !error.uncertain);
});

test("poll transport failures instruct retrying status and never claim a new submission", async () => {
  const provider = createVeoProvider(env, async () => { throw new TypeError("network unavailable"); });
  await assert.rejects(provider.status({ operation_id: "models/veo-3.1-fast-generate-preview/operations/example" }), (error) => !error.uncertain && /Retry status/.test(error.message));
  await assert.rejects(provider.start(input), (error) => error.uncertain && /may still be charged/.test(error.message));
});
