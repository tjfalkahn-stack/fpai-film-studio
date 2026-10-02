import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

const OPERATION = "models/veo-3.1-fast-generate-preview/operations/bwq9vmmq1qvk";
const JOB_ID = "f80a73e3-0113-4228-9f31-ca61a9d6aea1";

function envWith(fetchImpl, extra = {}) {
  return {
    FPAI_CONTROL_TOKEN: "control-token",
    GEMINI_API_KEY: "gemini-secret-key",
    GENERATION_DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
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
                envWith.lastUpdate = { sql, args };
                return { success: true };
              },
            };
          },
        };
      },
    },
    ...extra,
  };
}

test("diagnostic rejects unauthenticated callers", async () => {
  const response = await worker.fetch(
    new Request(`https://adapter/api/diagnostics/veo-operation?operation=${encodeURIComponent(OPERATION)}`),
    envWith(),
  );
  assert.equal(response.status, 401);
});

test("diagnostic uses Worker Gemini key for a GET-only operation poll via Bearer auth", async () => {
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
            "Sorry, we can’t create videos from input images containing celebrity or their likenesses. Support codes: 15236754",
          ],
        },
      },
    });
  };
  try {
    const response = await worker.fetch(
      new Request(`https://adapter/api/diagnostics/veo-operation?operation=${encodeURIComponent(OPERATION)}&jobId=${JOB_ID}`, {
        headers: { authorization: "Bearer control-token" },
      }),
      envWith(),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.generationStarted, false);
    assert.equal(body.authVia, "bearer");
    assert.equal(body.filter.filtered, true);
    assert.match(body.filter.message, /celebrity/i);
    assert.deepEqual(body.filter.supportCodes, ["15236754"]);
    assert.equal(body.errorUpdated, true);
    assert.equal(calls.length, 1);
    const headerBag = new Headers(calls[0].headers);
    assert.equal(headerBag.get("x-goog-api-key"), "gemini-secret-key");
    assert.equal(JSON.stringify(body).includes("gemini-secret-key"), false);
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
      new Request(`https://adapter/api/diagnostics/veo-operation?operation=${encodeURIComponent(OPERATION)}`, {
        headers: { "cf-worker": "fpai-film-studio-veo-diagnose" },
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
