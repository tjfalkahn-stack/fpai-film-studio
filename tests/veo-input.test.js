import test from "node:test";
import assert from "node:assert/strict";
import { createVeoProvider, veoOutputFilter } from "../worker/providers/veo.js";

const env = { LIVE_RENDERING_ENABLED: "true", MOCK_E2E_VERIFIED: "true", GEMINI_API_KEY: "test-secret" };
const reference = { mimeType: "image/png", data: "iVBORw0KGgo=" };
const input = { projectId: "enemies-closer", prompt: "Cinema. Marcus turns toward the door.", duration: 8, resolution: "1080p", aspectRatio: "16:9", referenceImages: [reference] };

test("veoOutputFilter reads Google RAI reason text and support codes", () => {
  const filter = veoOutputFilter({
    done: true,
    response: {
      generateVideoResponse: {
        raiMediaFilteredCount: 1,
        raiMediaFilteredReasons: [
          "Sorry, we can’t create videos from input images containing celebrity or their likenesses. Support codes: 15236754",
        ],
      },
    },
  });
  assert.equal(filter.filtered, true);
  assert.equal(filter.count, 1);
  assert.deepEqual(filter.supportCodes, ["15236754"]);
  assert.match(filter.message, /celebrity/i);
});

test("status surfaces OUTPUT_FILTERED reasons instead of a vague no-video message", async () => {
  const provider = createVeoProvider(env, async () =>
    Response.json({
      done: true,
      response: {
        generateVideoResponse: {
          raiMediaFilteredCount: 1,
          raiMediaFilteredReasons: [
            "1 videos were filtered out because they violated Google’s Responsible AI practices. You will not be charged for blocked videos.",
          ],
        },
      },
    }),
  );
  const result = await provider.status({
    operation_id: "models/veo-3.1-fast-generate-preview/operations/example",
    estimated_cost: 0.96,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.actualCost, 0);
  assert.equal(result.costBasis, "provider-output-filtered-no-charge");
  assert.equal(result.error.code, "OUTPUT_FILTERED");
  assert.match(result.error.message, /will not be charged/i);
  assert.deepEqual(result.error.raiMediaFilteredReasons.length, 1);
});

test("status keeps NO_OUTPUT when Google returns neither video nor filter fields", async () => {
  const provider = createVeoProvider(env, async () =>
    Response.json({ done: true, response: { generateVideoResponse: {} } }),
  );
  const result = await provider.status({
    operation_id: "models/veo-3.1-fast-generate-preview/operations/example",
    estimated_cost: 0.96,
  });
  assert.equal(result.error.code, "NO_OUTPUT");
  assert.equal(result.actualCost, 0);
});

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

test("Google Lite and Standard send the chosen start and end frames to their own model routes", async () => {
  for (const [tier, expectedModel, expectedCost] of [
    ["lite", "veo-3.1-lite-generate-preview", 0.4],
    ["standard", "veo-3.1-generate-preview", 3.2],
  ]) {
    let request;
    const provider = createVeoProvider(env, async (url, init) => {
      request = { url: String(url), payload: JSON.parse(init.body) };
      return Response.json({ name: `models/${expectedModel}/operations/example` });
    }, tier);
    assert.equal(provider.estimate({ duration: 8, resolution: "720p" }).estimatedCost, expectedCost);
    await provider.start({ ...input, referenceMode: "start-frame", endFrameImage: reference });
    assert.match(request.url, new RegExp(`models/${expectedModel}:predictLongRunning`));
    assert.deepEqual(request.payload.instances[0].image.inlineData, reference);
    assert.deepEqual(request.payload.instances[0].lastFrame.inlineData, reference);
  }
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
