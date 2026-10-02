import test from "node:test";
import assert from "node:assert/strict";
import { createVeoProvider, veoOutputFilter, veoInlineImage, validateVeoSubmission } from "../worker/providers/veo.js";

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

test("veoInlineImage uses bytesBase64Encoded instead of Gemini inlineData", () => {
  assert.deepEqual(veoInlineImage(reference), {
    mimeType: "image/png",
    bytesBase64Encoded: "iVBORw0KGgo=",
  });
});

test("Enemies Closer explicit start-frame mode animates the composed still", async () => {
  let payload;
  const provider = createVeoProvider(env, async (_url, init) => {
    payload = JSON.parse(init.body);
    return Response.json({ name: "models/veo-3.1-fast-generate-preview/operations/example" });
  });
  await provider.start({ ...input, referenceMode: "start-frame" });
  assert.deepEqual(payload.instances[0].image, {
    mimeType: reference.mimeType,
    bytesBase64Encoded: reference.data,
  });
  assert.equal(payload.instances[0].image.inlineData, undefined);
  assert.equal(payload.instances[0].referenceImages, undefined);
  assert.equal(payload.parameters.personGeneration, "allow_adult");
  assert.equal(payload.parameters.durationSeconds, 8);
});

test("Oct 2 HTTP 400 regression: portrait start-frame Fast uses bytesBase64Encoded image field", async () => {
  let payload;
  const provider = createVeoProvider(env, async (_url, init) => {
    payload = JSON.parse(init.body);
    return Response.json({ name: "models/veo-3.1-fast-generate-preview/operations/example" });
  });
  await provider.start({
    projectId: "the-yard-homecoming",
    sceneId: "CREATE",
    shotId: "DIRECT_52cc5698ddb70ab86f03ab7e3798dec8",
    prompt: "Create an 8-second vertical 9:16 cinematic video using the reference image of two adult women walking together.",
    duration: 8,
    resolution: "1080p",
    aspectRatio: "9:16",
    referenceMode: "start-frame",
    referenceImages: [{ mimeType: "image/jpeg", data: "/9j/4AAQ" }],
  });
  assert.deepEqual(payload.instances[0].image, {
    mimeType: "image/jpeg",
    bytesBase64Encoded: "/9j/4AAQ",
  });
  assert.equal(payload.parameters.aspectRatio, "9:16");
  assert.equal(payload.parameters.resolution, "1080p");
  assert.equal(payload.parameters.durationSeconds, 8);
  assert.equal(typeof payload.parameters.durationSeconds, "number");
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
    assert.deepEqual(request.payload.instances[0].image, veoInlineImage(reference));
    assert.deepEqual(request.payload.instances[0].lastFrame, veoInlineImage(reference));
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
  assert.deepEqual(payload.instances[0].referenceImages[0].image, veoInlineImage(reference));
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

test("reference-images mode rejects 9:16 before contacting Google", async () => {
  let calls = 0;
  const provider = createVeoProvider(env, async () => { calls++; });
  await assert.rejects(
    provider.start({
      ...input,
      referenceMode: "reference-images",
      aspectRatio: "9:16",
      referenceImages: [reference, reference],
    }),
    /16:9/,
  );
  assert.equal(calls, 0);
  assert.throws(
    () => validateVeoSubmission({ ...input, referenceMode: "reference-images", aspectRatio: "9:16", referenceImages: [reference] }),
    /16:9/,
  );
});

test("PROVIDER_HTTP surfaces Google's exact 400 message for Your videos cards", async () => {
  const provider = createVeoProvider(env, async () =>
    Response.json(
      {
        error: {
          code: 400,
          message: "Invalid value at 'instances[0].image' (inlineData is not supported; use bytesBase64Encoded)",
          status: "INVALID_ARGUMENT",
        },
      },
      { status: 400 },
    ),
  );
  await assert.rejects(provider.start({ ...input, referenceMode: "start-frame" }), (error) => {
    assert.equal(error.code, "PROVIDER_HTTP");
    assert.equal(error.providerHttpStatus, 400);
    assert.match(error.message, /bytesBase64Encoded|inlineData|Invalid value/i);
    assert.match(error.message, /HTTP 400/);
    assert.equal(error.uncertain, false);
    return true;
  });
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
