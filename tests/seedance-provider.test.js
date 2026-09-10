import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { createSeedanceProvider } from "../worker/providers/seedance.js";
import { validateInput } from "../worker/providers/contract.js";
import { falSubmitUrl, parseFalOperationId } from "../worker/providers/falQueue.js";

const png = { mimeType: "image/png", data: "iVBORw0KGgo=" };
const liveEnv = {
  LIVE_RENDERING_ENABLED: "true",
  MOCK_E2E_VERIFIED: "true",
  SEEDANCE_LIVE_ENABLED: "true",
  FAL_KEY: "test-fal-key",
};

function input(extra = {}) {
  return {
    projectId: "enemies-closer-ep01",
    sceneId: "001",
    shotId: "010",
    provider: "seedance-fast",
    prompt: "Jasmine moving with young Mikey through a tense nighttime tarmac",
    duration: 6,
    resolution: "720p",
    aspectRatio: "16:9",
    generateAudio: true,
    referenceImages: [],
    ...extra,
  };
}

test("Seedance start uses the fal queue, never blocks on the result, and keeps FAL_KEY off the URL", async () => {
  const calls = [];
  const provider = createSeedanceProvider(liveEnv, async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      request_id: "req_seedance_12345678",
      status: "IN_QUEUE",
      status_url: "https://queue.fal.run/bytedance/seedance-2.0/fast/text-to-video/requests/req_seedance_12345678/status",
    });
  }, { tier: "fast" });
  validateInput(input(), provider.capabilities);
  const started = await provider.start(input());
  assert.equal(
    started.operationId,
    "fal:bytedance/seedance-2.0/fast/text-to-video:req_seedance_12345678",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Key test-fal-key");
  assert.equal(calls[0].url.includes("test-fal-key"), false);
  assert.match(calls[0].url, /queue\.fal\.run\/bytedance\/seedance-2\.0\/fast\/text-to-video$/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.duration, "6");
  assert.equal(body.generate_audio, true);
});

test("queue status, result retrieval, and safe asset download", async () => {
  const provider = createSeedanceProvider(liveEnv, async (url, init) => {
    const target = String(url);
    if (target.endsWith("/status")) {
      return Response.json({ status: "COMPLETED", request_id: "req_seedance_12345678" });
    }
    if (target.includes("/requests/req_seedance_12345678") && init.method !== "PUT") {
      return Response.json({
        seed: 7,
        video: {
          url: "https://v3b.fal.media/files/output.mp4",
          content_type: "video/mp4",
          file_size: 1234,
        },
      });
    }
    if (target === "https://v3b.fal.media/files/output.mp4") {
      assert.equal(init.headers?.authorization, undefined);
      return new Response("mp4-bytes", { headers: { "content-type": "video/mp4" } });
    }
    throw new Error(`Unexpected ${target}`);
  });
  const job = {
    operation_id: "fal:bytedance/seedance-2.0/fast/text-to-video:req_seedance_12345678",
    estimated_cost: 1.4514,
  };
  const running = createSeedanceProvider(liveEnv, async () =>
    Response.json({ status: "IN_PROGRESS" }),
  );
  assert.equal((await running.status(job)).status, "running");
  const completed = await provider.status(job);
  assert.equal(completed.status, "completed");
  assert.equal(completed.actualCost, 1.4514);
  assert.equal(completed.asset.seed, 7);
  assert.equal(completed.asset.requestId, "req_seedance_12345678");
  const asset = await provider.asset({ asset_json: JSON.stringify(completed.asset) });
  assert.equal(await asset.text(), "mp4-bytes");
});

test("provider failure and in-queue cancel handling", async () => {
  const failed = createSeedanceProvider(liveEnv, async () =>
    Response.json({ status: "FAILED" }),
  );
  const failedStatus = await failed.status({
    operation_id: "fal:bytedance/seedance-2.0/text-to-video:req_failed_status1",
    estimated_cost: 1.8,
  });
  assert.equal(failedStatus.status, "failed");
  assert.equal(failedStatus.actualCost, 0);

  const canceled = createSeedanceProvider(liveEnv, async (url, init) => {
    if (String(url).endsWith("/status")) return Response.json({ status: "IN_QUEUE" });
    assert.equal(init.method, "PUT");
    assert.match(String(url), /\/cancel$/);
    return Response.json({ success: true });
  });
  const result = await canceled.cancel({
    operation_id: "fal:bytedance/seedance-2.0/fast/text-to-video:req_cancel_queued1",
    estimated_cost: 1.4514,
  });
  assert.equal(result.status, "canceled");
  assert.equal(result.actualCost, 0);
});

test("secret absence allows quoting but blocks start", async () => {
  const provider = createSeedanceProvider(
    { LIVE_RENDERING_ENABLED: "true", MOCK_E2E_VERIFIED: "true", SEEDANCE_LIVE_ENABLED: "true" },
    async () => {
      throw new Error("fal.ai must not be contacted without FAL_KEY");
    },
  );
  assert.equal(provider.estimate(input()).estimatedCost, 1.4514);
  await assert.rejects(provider.start(input()), /FAL_KEY is not configured/);
});

test("Seedance live gate stays disabled even when the master live flag is on", async () => {
  const provider = createSeedanceProvider(
    {
      LIVE_RENDERING_ENABLED: "true",
      MOCK_E2E_VERIFIED: "true",
      SEEDANCE_LIVE_ENABLED: "false",
      FAL_KEY: "test-fal-key",
    },
    async () => {
      throw new Error("Seedance must not be contacted while SEEDANCE_LIVE_ENABLED is false");
    },
  );
  await assert.rejects(provider.start(input()), /Seedance live rendering is disabled/);
});

test("webhook-ready submit URL is used only when configured", () => {
  assert.equal(
    falSubmitUrl("bytedance/seedance-2.0/fast/text-to-video", {}),
    "https://queue.fal.run/bytedance/seedance-2.0/fast/text-to-video",
  );
  assert.match(
    falSubmitUrl("bytedance/seedance-2.0/fast/text-to-video", {
      SEEDANCE_WEBHOOK_URL: "https://adapter.example/api/webhooks/fal?token=secret",
    }),
    /fal_webhook=https%3A%2F%2Fadapter\.example%2Fapi%2Fwebhooks%2Ffal/,
  );
  const parsed = parseFalOperationId(
    "fal:bytedance/seedance-2.0/reference-to-video:req_abc-12345678",
  );
  assert.equal(parsed.endpointId, "bytedance/seedance-2.0/reference-to-video");
  assert.equal(parsed.requestId, "req_abc-12345678");
});

test("render API quotes Seedance, rejects live submit, and rejects over-ceiling jobs without calling fal", async (t) => {
  const network = t.mock.method(globalThis, "fetch", () => {
    throw new Error("NETWORK FORBIDDEN DURING SEEDANCE QUOTE");
  });
  const env = {
    FPAI_CONTROL_TOKEN: "test",
    LIVE_RENDERING_ENABLED: "false",
    SEEDANCE_LIVE_ENABLED: "false",
    FAL_KEY: "must-not-leak",
    RENDER_PROJECT_ID: "enemies-closer-ep01",
    MAX_SINGLE_JOB_USD: "4",
  };
  const headers = {
    authorization: "Bearer test",
    "content-type": "application/json",
  };
  const quoteResponse = await worker.fetch(
    new Request("http://localhost/api/renders", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input(), estimateOnly: true }),
    }),
    env,
  );
  const quote = await quoteResponse.json();
  assert.equal(quoteResponse.status, 200);
  assert.equal(quote.estimatedCost, 1.4514);
  assert.equal(quote.seedanceLiveEnabled, false);
  assert.equal(JSON.stringify(quote).includes("must-not-leak"), false);
  assert.equal(quote.rationale.providerSelected, "seedance-fast");
  assert.equal(quote.capabilities.audio, true);
  assert.equal(quote.capabilities.maxReferences, 9);

  const blocked = await worker.fetch(
    new Request("http://localhost/api/renders", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...input(),
        requestKey: "seedance-blocked-key-01",
        acceptedCost: 1.4514,
      }),
    }),
    env,
  );
  assert.equal(blocked.status, 403);

  const catalog = await worker.fetch(new Request("http://localhost/api/renderers", { headers }), env);
  const catalogBody = await catalog.json();
  assert.deepEqual(
    catalogBody.providers.map((item) => item.id),
    ["mock", "comfy-video", "seedance-fast", "seedance-standard", "veo-fast"],
  );
  assert.equal(JSON.stringify(catalogBody).includes("must-not-leak"), false);

  Object.assign(env, {
    LIVE_RENDERING_ENABLED: "true",
    MOCK_E2E_VERIFIED: "true",
    SEEDANCE_LIVE_ENABLED: "true",
    GENERATION_DB: {
      prepare() {
        throw new Error("budget rejection must happen before persistence");
      },
    },
    GENERATION_MEDIA: {},
  });
  const expensive = await worker.fetch(
    new Request("http://localhost/api/renders", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...input({
          provider: "seedance-standard",
          duration: 15,
          resolution: "1080p",
        }),
        requestKey: "seedance-too-expensive-01",
        acceptedCost: 10.23,
        continuity: {
          ready: true,
          animaticLocked: true,
          timingApproved: true,
          hasCharacters: false,
        },
      }),
    }),
    env,
  );
  const expensiveBody = await expensive.json();
  assert.equal(expensive.status, 409);
  assert.equal(expensiveBody.error.code, "COST_CEILING");
  assert.equal(network.mock.callCount(), 0);
});

test("webhook endpoint is ready and stays closed without a secret", async () => {
  const env = { FPAI_CONTROL_TOKEN: "test" };
  const missing = await worker.fetch(
    new Request("http://localhost/api/webhooks/fal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request_id: "req_seedance_12345678" }),
    }),
    env,
  );
  assert.equal(missing.status, 503);
  env.SEEDANCE_WEBHOOK_SECRET = "hook-secret";
  const unauthorized = await worker.fetch(
    new Request("http://localhost/api/webhooks/fal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request_id: "req_seedance_12345678" }),
    }),
    env,
  );
  assert.equal(unauthorized.status, 401);
});
