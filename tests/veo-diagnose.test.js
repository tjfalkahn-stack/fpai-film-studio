import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

const OPERATION = "models/veo-3.1-fast-generate-preview/operations/bwq9vmmq1qvk";
const JOB_ID = "f80a73e3-0113-4228-9f31-ca61a9d6aea1";
const KEY = "gemini-secret-key";

function envWith(extra = {}) {
  const state = { updates: 0, lastUpdate: null, sql: [] };
  const env = {
    FPAI_CONTROL_TOKEN: "control-token",
    GEMINI_API_KEY: KEY,
    GENERATION_DB: {
      prepare(sql) {
        state.sql.push(sql);
        return {
          bind(...args) {
            return {
              async first() {
                if (/UPDATE/i.test(sql) || /INSERT/i.test(sql)) {
                  state.updates += 1;
                  state.lastUpdate = { sql, args };
                }
                if (/FROM renders WHERE id=/.test(sql)) {
                  return {
                    id: JOB_ID,
                    status: "failed",
                    provider: "veo-fast",
                    operation_id: OPERATION,
                    error_json: JSON.stringify({ code: "NO_OUTPUT", message: "possibly filtered" }),
                    actual_cost: 0,
                    cost_basis: "provider-no-video",
                  };
                }
                return null;
              },
              async run() {
                state.updates += 1;
                state.lastUpdate = { sql, args };
                return { success: true };
              },
            };
          },
        };
      },
    },
    ...extra,
  };
  env._state = state;
  return env;
}

function diagnoseRequest(query, headers = { authorization: "Bearer control-token" }) {
  return new Request(`https://adapter/api/diagnostics/veo-operation?${query}`, { headers });
}

test("diagnostic rejects unauthenticated callers", async () => {
  const response = await worker.fetch(
    diagnoseRequest(`operation=${encodeURIComponent(OPERATION)}`, {}),
    envWith(),
  );
  assert.equal(response.status, 401);
});

test("diagnostic GET-only poll returns filtered audio reason without DB writes or generation", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", headers: init.headers });
    assert.equal(init.method || "GET", "GET");
    assert.equal(String(url).includes("predictLongRunning"), false);
    return Response.json({
      name: OPERATION,
      done: true,
      response: {
        generateVideoResponse: {
          raiMediaFilteredCount: 1,
          raiMediaFilteredReasons: [
            "We encountered an issue with the audio for your prompt, which means we could not create your video. Support codes: 15236754",
          ],
        },
      },
    });
  };
  const env = envWith();
  try {
    const response = await worker.fetch(
      diagnoseRequest(`operation=${encodeURIComponent(OPERATION)}&jobId=${JOB_ID}`),
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.generationStarted, false);
    assert.equal(body.authVia, "bearer");
    assert.equal(body.filter.filtered, true);
    assert.equal(body.hasVideo, false);
    assert.equal(body.videoKind, null);
    assert.equal(body.outcome.code, "OUTPUT_FILTERED");
    assert.match(body.filter.message, /audio for your prompt/i);
    assert.deepEqual(body.filter.supportCodes, ["15236754"]);
    assert.equal(body.errorUpdated, undefined);
    assert.equal(env._state.updates, 0);
    assert.equal(calls.length, 1);
    assert.equal(new Headers(calls[0].headers).get("x-goog-api-key"), KEY);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(KEY), false);
    assert.equal(serialized.includes("predictLongRunning"), false);
    assert.equal("response" in body, false);
    assert.equal("instances" in body, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("diagnostic URI output is summarized without returning the download URI", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      done: true,
      response: {
        generateVideoResponse: {
          generatedSamples: [
            { video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/secret-file" } },
          ],
        },
      },
    });
  try {
    const response = await worker.fetch(
      diagnoseRequest(`operation=${encodeURIComponent(OPERATION)}`),
      envWith(),
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.hasVideo, true);
    assert.equal(body.videoKind, "uri");
    assert.equal(body.outcome.status, "completed");
    assert.equal(JSON.stringify(body).includes("secret-file"), false);
    assert.equal(body.asset, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("diagnostic inline output does not leak video bytes or prompts", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      done: true,
      response: {
        generateVideoResponse: {
          generatedSamples: [{ video: { data: "VERY_PRIVATE_VIDEO_BYTES", mimeType: "video/mp4" } }],
        },
      },
    });
  try {
    const response = await worker.fetch(
      diagnoseRequest(`operation=${encodeURIComponent(OPERATION)}`),
      envWith(),
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);
    assert.equal(body.hasVideo, true);
    assert.equal(body.videoKind, "inline");
    assert.equal(serialized.includes("VERY_PRIVATE_VIDEO_BYTES"), false);
    assert.equal(serialized.includes("Girl, are you coming to homecoming"), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("diagnostic malformed Google JSON stays bounded and write-free", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-json", { headers: { "content-type": "text/plain" } });
  const env = envWith();
  try {
    const response = await worker.fetch(
      diagnoseRequest(`operation=${encodeURIComponent(OPERATION)}&jobId=${JOB_ID}`),
      env,
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.generationStarted, false);
    assert.equal(body.outcome.code, "MALFORMED_RESPONSE");
    assert.equal(env._state.updates, 0);
    assert.equal(JSON.stringify(body).includes("not-json"), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("diagnostic allows allowlisted service-binding callers without Bearer", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      name: OPERATION,
      done: true,
      response: {
        generateVideoResponse: {
          raiMediaFilteredCount: 1,
          raiMediaFilteredReasons: ["Blocked for testing."],
        },
      },
    });
  try {
    const response = await worker.fetch(
      diagnoseRequest(`operation=${encodeURIComponent(OPERATION)}`, {
        "cf-worker": "fpai-film-studio-veo-diagnose",
      }),
      envWith(),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authVia, "service-binding");
    assert.equal(body.filter.raiMediaFilteredReasons[0], "Blocked for testing.");
  } finally {
    globalThis.fetch = original;
  }
});

test("diagnostic allows one-shot diagnose run token without Bearer", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      name: OPERATION,
      done: true,
      response: {
        generateVideoResponse: {
          raiMediaFilteredCount: 1,
          raiMediaFilteredReasons: ["Token-gated diagnose reason."],
        },
      },
    });
  try {
    const response = await worker.fetch(
      diagnoseRequest(`operation=${encodeURIComponent(OPERATION)}&diagnoseToken=run-gate`, {
        "x-fpai-diagnose-run": "run-gate",
      }),
      envWith({ DIAGNOSE_RUN_TOKEN: "run-gate" }),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authVia, "diagnose-run-token");
    assert.equal(body.filter.raiMediaFilteredReasons[0], "Token-gated diagnose reason.");
  } finally {
    globalThis.fetch = original;
  }
});
