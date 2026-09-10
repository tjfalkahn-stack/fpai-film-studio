import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import worker from "../worker/index.js";
import { SEEDANCE_CONTROLLED_TEST } from "../src/seedanceControlledTest.js";
import { config } from "../worker/renders.js";

const png = { mimeType: "image/png", data: "iVBORw0KGgo=" };
const continuity = {
  ready: true,
  animaticLocked: true,
  timingApproved: true,
  hasCharacters: true,
};

function planBody(extra = {}) {
  return {
    projectId: SEEDANCE_CONTROLLED_TEST.projectId,
    sceneId: SEEDANCE_CONTROLLED_TEST.sceneId,
    shotId: SEEDANCE_CONTROLLED_TEST.shotId,
    provider: SEEDANCE_CONTROLLED_TEST.provider,
    prompt: "CONTROL · Jasmine moving with young Mikey through a tense nighttime tarmac",
    duration: SEEDANCE_CONTROLLED_TEST.duration,
    resolution: SEEDANCE_CONTROLLED_TEST.resolution,
    aspectRatio: "16:9",
    generateAudio: true,
    referenceImages: [
      { ...png, characterId: "jasmine", role: "character" },
      { ...png, characterId: "mikey", role: "character" },
    ],
    environmentReferences: [{ ...png, role: "environment", name: "Tarmac Master 01" }],
    continuity,
    acceptedCost: 1.4514,
    ...extra,
  };
}

async function withEnv(bindings, fn) {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test");}}',
    d1Databases: ["GENERATION_DB"],
    r2Buckets: ["GENERATION_MEDIA"],
  });
  try {
    const db = await mf.getD1Database("GENERATION_DB");
    for (const file of ["worker/schema.sql", "worker/render-schema.sql", "worker/character-schema.sql"]) {
      const sql = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/^--.*$/gm, "");
      for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
        await db.prepare(statement).run();
      }
    }
    const env = {
      GENERATION_DB: db,
      GENERATION_MEDIA: await mf.getR2Bucket("GENERATION_MEDIA"),
      FPAI_CONTROL_TOKEN: "test",
      LIVE_RENDERING_ENABLED: "false",
      MOCK_E2E_VERIFIED: "false",
      SEEDANCE_LIVE_ENABLED: "false",
      RENDER_PROJECT_ID: "enemies-closer-ep01",
      RENDER_SESSION_CEILING_USD: "10",
      RENDER_PROJECT_CEILING_USD: "20",
      MAX_SINGLE_JOB_USD: "4",
      ...bindings,
    };
    await fn(env, db);
  } finally {
    await mf.dispose();
  }
}

async function call(env, path, payload, auth = true) {
  const response = await worker.fetch(
    new Request(`http://localhost${path}`, {
      method: payload ? "POST" : "GET",
      headers: {
        ...(auth ? { authorization: "Bearer test" } : {}),
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    }),
    env,
  );
  return { response, data: await response.json() };
}

test("LIVE_RENDERING_ENABLED=false + authorized Seedance test executes exactly one job; second job and Veo stay closed", async (t) => {
  await withEnv(
    {
      SEEDANCE_LIVE_ENABLED: "true",
      FAL_KEY: "test-fal-key",
      GEMINI_API_KEY: "must-not-enable-veo",
    },
    async (env) => {
      const network = t.mock.method(globalThis, "fetch", async (url, init) => {
        const target = String(url);
        if (target.includes("queue.fal.run/bytedance/seedance-2.0/fast/reference-to-video") && init?.method === "POST") {
          assert.equal(init.headers.authorization, "Key test-fal-key");
          assert.equal(target.includes("test-fal-key"), false);
          return Response.json({
            request_id: "req_seedance_controlled_01",
            status: "IN_QUEUE",
          });
        }
        throw new Error(`NETWORK FORBIDDEN DURING SEEDANCE CONTROLLED TEST: ${target}`);
      });

      const policy = config(env);
      assert.equal(policy.liveEnabled, false);
      assert.equal(policy.seedanceLiveEnabled, true);
      assert.equal(policy.seedanceControlledTest.maxJobs, 1);
      assert.equal(policy.seedanceControlledTest.maxEstimatedCostUsd, 1.46);
      assert.equal(env.LIVE_RENDERING_ENABLED, "false");
      assert.equal(env.MOCK_E2E_VERIFIED, "false");

      const health = await worker.fetch(new Request("http://localhost/health"), env);
      const healthBody = await health.json();
      assert.equal(healthBody.liveRenderingEnabled, false);
      assert.equal(healthBody.liveExecutionReady, false);
      assert.equal(healthBody.seedanceLiveEnabled, true);

      const veo = await call(env, "/api/renders", {
        projectId: "enemies-closer-ep01",
        sceneId: "001",
        shotId: "027",
        provider: "veo-fast",
        prompt: "Marcus hero reveal",
        duration: 8,
        resolution: "720p",
        aspectRatio: "16:9",
        referenceImages: [],
        requestKey: "veo-must-stay-disabled-01",
        acceptedCost: 0.8,
        continuity: { ready: true, animaticLocked: true, timingApproved: true, hasCharacters: false },
      });
      assert.equal(veo.response.status, 403);
      assert.equal(veo.data.error.code, "LIVE_DISABLED");

      const first = await call(
        env,
        "/api/renders",
        planBody({ requestKey: "seedance-controlled-job-01" }),
      );
      assert.equal(first.response.status, 202);
      assert.equal(first.data.render.provider, "seedance-fast");
      assert.equal(first.data.render.status, "queued");
      assert.equal(first.data.render.estimatedCost, 1.4514);

      const started = await call(env, `/api/renders/${first.data.render.id}`);
      assert.equal(started.response.status, 200);
      assert.equal(started.data.render.status, "running");
      assert.equal(
        started.data.render.operationId,
        "fal:bytedance/seedance-2.0/fast/reference-to-video:req_seedance_controlled_01",
      );
      assert.equal(network.mock.callCount(), 1);

      const duplicate = await call(
        env,
        "/api/renders",
        planBody({ requestKey: "seedance-controlled-job-01" }),
      );
      assert.equal(duplicate.response.status, 200);
      assert.equal(duplicate.data.render.id, first.data.render.id);
      assert.equal(duplicate.data.duplicate, true);

      const second = await call(
        env,
        "/api/renders",
        planBody({ requestKey: "seedance-controlled-job-02" }),
      );
      assert.equal(second.response.status, 403);
      assert.equal(second.data.error.code, "SEEDANCE_JOB_LIMIT");
      assert.equal(network.mock.callCount(), 1);
    },
  );
});

test("Seedance live flag false rejects the controlled test without contacting fal", async (t) => {
  const network = t.mock.method(globalThis, "fetch", () => {
    throw new Error("NETWORK FORBIDDEN WHILE SEEDANCE LIVE FLAG IS FALSE");
  });
  await withEnv({ FAL_KEY: "test-fal-key" }, async (env) => {
    const blocked = await call(env, "/api/renders", planBody({ requestKey: "seedance-flag-off-01" }));
    assert.equal(blocked.response.status, 403);
    assert.equal(blocked.data.error.code, "LIVE_DISABLED");
    assert.equal(config(env).liveEnabled, false);
    assert.equal(config(env).seedanceLiveEnabled, false);
    assert.equal(network.mock.callCount(), 0);
  });
});

test("Missing FAL_KEY rejects the authorized Seedance plan before persistence", async (t) => {
  const network = t.mock.method(globalThis, "fetch", () => {
    throw new Error("NETWORK FORBIDDEN WITHOUT FAL_KEY");
  });
  await withEnv({ SEEDANCE_LIVE_ENABLED: "true" }, async (env) => {
    env.GENERATION_DB = {
      prepare() {
        throw new Error("missing FAL_KEY must fail before persistence");
      },
    };
    const blocked = await call(env, "/api/renders", planBody({ requestKey: "seedance-missing-key-01" }));
    assert.equal(blocked.response.status, 503);
    assert.equal(blocked.data.error.code, "PROVIDER_CONFIG");
    assert.match(blocked.data.error.message, /FAL_KEY/);
    assert.equal(config(env).liveEnabled, false);
    assert.equal(network.mock.callCount(), 0);
  });
});

test("Seedance estimated spend above $1.46 is rejected while Veo stays disabled", async (t) => {
  const network = t.mock.method(globalThis, "fetch", () => {
    throw new Error("NETWORK FORBIDDEN DURING SEEDANCE BUDGET REJECTION");
  });
  await withEnv(
    {
      SEEDANCE_LIVE_ENABLED: "true",
      FAL_KEY: "test-fal-key",
      SEEDANCE_FAST_720P_PER_SECOND_USD: "0.25",
      GEMINI_API_KEY: "must-not-enable-veo",
    },
    async (env) => {
      env.GENERATION_DB = {
        prepare() {
          throw new Error("budget rejection must happen before persistence");
        },
      };
      const quote = await call(env, "/api/renders", planBody({ estimateOnly: true }));
      assert.equal(quote.response.status, 200);
      assert.equal(quote.data.estimatedCost, 1.5);
      assert.equal(quote.data.liveEnabled, false);
      assert.equal(quote.data.seedanceLiveEnabled, true);
      assert.ok(quote.data.estimatedCost > 1.46);

      const blocked = await call(
        env,
        "/api/renders",
        planBody({ requestKey: "seedance-over-budget-01", acceptedCost: 1.5 }),
      );
      assert.equal(blocked.response.status, 409);
      assert.equal(blocked.data.error.code, "COST_CEILING");
      assert.equal(config(env).liveEnabled, false);
      assert.equal(network.mock.callCount(), 0);
    },
  );
});
