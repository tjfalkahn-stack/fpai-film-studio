import test from "node:test";
import assert from "node:assert/strict";
import { readVeoOutcome, sanitizeVeoText } from "../worker/providers/veo.js";
import { createVeoProvider } from "../worker/providers/veo.js";

const OPERATION = "models/veo-3.1-fast-generate-preview/operations/bwq9vmmq1qvk";
const KEY = "gemini-secret-key";

test("sanitizeVeoText redacts secrets and bounds length", () => {
  const long = `${"x".repeat(500)} ${KEY}`;
  const out = sanitizeVeoText(long, [KEY]);
  assert.equal(out.includes(KEY), false);
  assert.ok(out.length <= 400);
});

test("readVeoOutcome reports OUTPUT_FILTERED reasons and support codes", () => {
  const outcome = readVeoOutcome({
    done: true,
    response: {
      generateVideoResponse: {
        raiMediaFilteredCount: 1,
        raiMediaFilteredReasons: [
          "We encountered an issue with the audio for your prompt. Support codes: 15236754",
        ],
      },
    },
  });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.code, "OUTPUT_FILTERED");
  assert.equal(outcome.hasVideo, false);
  assert.match(outcome.message, /audio for your prompt/i);
  assert.deepEqual(outcome.filter.supportCodes, ["15236754"]);
});

test("readVeoOutcome treats URI output as completed and not filtered", () => {
  const outcome = readVeoOutcome({
    done: true,
    response: {
      generateVideoResponse: {
        generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/abc" } }],
      },
    },
  });
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.videoKind, "uri");
  assert.equal(outcome.hasVideo, true);
  assert.equal(outcome.filter.filtered, false);
});

test("readVeoOutcome treats inline video bytes as completed", () => {
  const outcome = readVeoOutcome({
    done: true,
    response: {
      generateVideoResponse: {
        generatedSamples: [{ video: { data: "AAAA", mimeType: "video/mp4" } }],
      },
    },
  });
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.videoKind, "inline");
  assert.equal(outcome.asset.data, "AAAA");
});

test("readVeoOutcome marks malformed payloads without throwing", () => {
  for (const payload of [null, undefined, [], "done", 7, { raw: "not-json" }]) {
    const outcome = readVeoOutcome(payload);
    assert.equal(outcome.code, "MALFORMED_RESPONSE");
    assert.equal(outcome.hasVideo, false);
    assert.equal(JSON.stringify(outcome).includes("not-json"), false);
  }
});

test("readVeoOutcome redacts API keys from Google error and filter text", () => {
  const outcome = readVeoOutcome(
    {
      done: true,
      error: { code: 400, message: `invalid key ${KEY}` },
    },
    { apiKey: KEY },
  );
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.message.includes(KEY), false);
  assert.match(outcome.message, /\[redacted\]/);
});

test("status completes inline video and never treats it as OUTPUT_FILTERED", async () => {
  const provider = createVeoProvider(
    { LIVE_RENDERING_ENABLED: "true", MOCK_E2E_VERIFIED: "true", GEMINI_API_KEY: KEY },
    async () =>
      Response.json({
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { data: "QQ==" } }] } },
      }),
  );
  const result = await provider.status({ operation_id: OPERATION, estimated_cost: 0.96 });
  assert.equal(result.status, "completed");
  assert.equal(result.asset.data, "QQ==");
});
