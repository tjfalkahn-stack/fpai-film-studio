import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import worker from "../worker/index.js";
import { createVeoProvider } from "../worker/providers/veo.js";
import { validateInput } from "../worker/providers/contract.js";
import { mergeRender } from "../src/renderClient.js";
import { authorizeStudio } from "../frontend-worker/auth.js";
import { YARD_PROJECT_ID } from "../src/yardProduction.js";
let mf, db, env;
before(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test");}}',
    d1Databases: ["GENERATION_DB"],
    r2Buckets: ["GENERATION_MEDIA"],
  });
  db = await mf.getD1Database("GENERATION_DB");
  for (const file of ["worker/schema.sql", "worker/render-schema.sql", "worker/character-schema.sql"]) {
    const sql = readFileSync(
      new URL(`../${file}`, import.meta.url),
      "utf8",
    ).replace(/^--.*$/gm, "");
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
  }
  env = {
    GENERATION_DB: db,
    GENERATION_MEDIA: await mf.getR2Bucket("GENERATION_MEDIA"),
    FPAI_CONTROL_TOKEN: "test",
    LIVE_RENDERING_ENABLED: "false",
    RENDER_SESSION_CEILING_USD: "0.8",
    RENDER_PROJECT_CEILING_USD: "1.6",
  };
});
after(async () => {
  await mf?.dispose();
});
const body = (key = crypto.randomUUID(), extra = {}) => ({
  projectId: "enemies-closer-ep01",
  sceneId: "001",
  shotId: "027",
  provider: "mock",
  prompt: "CONTROL · Marcus hero reveal · Stabilized push-in",
  duration: 8,
  resolution: "720p",
  aspectRatio: "16:9",
  referenceImages: [],
  requestKey: key,
  acceptedCost: 0,
  ...extra,
});
async function call(path, payload, auth = true) {
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
const noNetwork = (t) =>
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("NETWORK FORBIDDEN DURING MOCK");
  });

test("mock Shot 027: queued → running → completed, persisted playable MP4, idempotent take/ledger, zero external requests", async (t) => {
  const network = noNetwork(t);
  const request = body();
  let { data, response } = await call("/api/renders", request);
  assert.equal(response.status, 202);
  assert.equal(data.render.status, "queued");
  const id = data.render.id;
  const duplicate = await call("/api/renders", request);
  assert.equal(duplicate.data.render.id, id);
  data = (await call(`/api/renders/${id}`)).data;
  assert.equal(data.render.status, "running");
  assert.match(data.render.operationId, /mock\//);
  await db
    .prepare("UPDATE renders SET created_at=? WHERE id=?")
    .bind("2020-01-01T00:00:00Z", id)
    .run();
  data = (await call(`/api/renders/${id}`)).data;
  assert.equal(data.render.status, "completed");
  assert.equal(data.render.actualCost, 0);
  assert.ok(data.render.outputAsset);
  const video = await worker.fetch(
    new Request(`http://localhost${data.render.outputAsset.url}`, {
      headers: { authorization: "Bearer test", range: "bytes=0-31" },
    }),
    env,
  );
  assert.equal(video.status, 206);
  assert.match(video.headers.get("content-range"), /^bytes 0-31\//);
  assert.match(new TextDecoder().decode(await video.arrayBuffer()), /ftyp/);
  let state = {
    project: { id: request.projectId },
    shots: [{ id: "027", scene: "001", takes: [] }],
    ledger: [],
  };
  state = mergeRender(mergeRender(state, data.render), data.render);
  assert.equal(state.shots[0].takes.length, 1);
  assert.equal(state.ledger.length, 1);
  assert.equal(state.ledger[0].actualCost, 0);
  assert.equal(network.mock.callCount(), 0);
});
test("live disabled blocks both render API and legacy paid route before network; quotes work at zero spend", async (t) => {
  const network = noNetwork(t);
  const quote = await call(
    "/api/renders",
    body(undefined, { provider: "veo-fast", estimateOnly: true }),
  );
  assert.equal(quote.data.estimatedCost, 0.8);
  assert.equal(
    (
      await call(
        "/api/renders",
        body(undefined, { provider: "veo-fast", acceptedCost: 0.8 }),
      )
    ).response.status,
    403,
  );
  assert.equal(
    (await call("/api/generation-jobs", { plan: {} })).response.status,
    403,
  );
  assert.equal(network.mock.callCount(), 0);
});
test("Vibes quotes a zero-dollar manual handoff and can never enter the render queue", async (t) => {
  const network = noNetwork(t);
  const quote = await call(
    "/api/renders",
    body(undefined, { provider: "vibes-manual", estimateOnly: true }),
  );
  assert.equal(quote.response.status, 200);
  assert.equal(quote.data.estimatedCost, 0);
  assert.equal(quote.data.capabilities.manual, true);
  assert.equal(quote.data.debug.referenceImagesTransmitted, 0);
  const blocked = await call(
    "/api/renders",
    body(undefined, { provider: "vibes-manual", acceptedCost: 0 }),
  );
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.data.error.code, "MANUAL_PROVIDER");
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM renders WHERE provider='vibes-manual'").first()).n,
    0,
  );
  assert.equal(network.mock.callCount(), 0);
});
test("Draw Things quotes a zero-dollar local handoff and can never enter the render queue", async (t) => {
  const network = noNetwork(t);
  const quote = await call(
    "/api/renders",
    body(undefined, {
      provider: "draw-things-local",
      duration: 1,
      resolution: "1024x576",
      estimateOnly: true,
    }),
  );
  assert.equal(quote.response.status, 200);
  assert.equal(quote.data.estimatedCost, 0);
  assert.equal(quote.data.capabilities.manual, true);
  assert.equal(quote.data.capabilities.local, true);
  assert.equal(quote.data.debug.referenceImagesTransmitted, 0);
  const blocked = await call(
    "/api/renders",
    body(undefined, {
      provider: "draw-things-local",
      duration: 1,
      resolution: "1024x576",
      acceptedCost: 0,
    }),
  );
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.data.error.code, "MANUAL_PROVIDER");
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM renders WHERE provider='draw-things-local'").first()).n,
    0,
  );
  assert.equal(network.mock.callCount(), 0);
});
test("auth fail closed, project scope, validation, and changed-payload idempotency", async (t) => {
  noNetwork(t);
  assert.equal(
    (await call("/api/renders", body(), false)).response.status,
    401,
  );
  assert.equal(
    (await call("/api/renders", body(undefined, { projectId: "other" })))
      .response.status,
    403,
  );
  assert.equal(
    (await call("/api/renders", body(undefined, { duration: 4.5 }))).response
      .status,
    400,
  );
  const b = body();
  await call("/api/renders", b);
  assert.equal(
    (await call("/api/renders", { ...b, prompt: "different" })).response.status,
    409,
  );
  assert.equal(
    await authorizeStudio(new Request("https://public.example/api/renders"), {
      LOCAL_DEV: "true",
    }),
    false,
  );
  assert.equal(
    await authorizeStudio(
      new Request("https://public.example/api/renders", {
        headers: { "cf-access-jwt-assertion": "forged" },
      }),
      {
        ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
        ACCESS_AUD: "test",
      },
    ),
    false,
  );
});
test("The Yard has an isolated render list and blocks paid jobs before provider execution", async (t) => {
  const network = noNetwork(t);
  const request = body(undefined, { projectId: YARD_PROJECT_ID, sceneId: "YARD", shotId: "PV", duration: 8 });
  const preview = await call("/api/renders", { ...request, estimateOnly: true });
  assert.equal(preview.response.status, 200);
  const paid = await call("/api/renders", { ...request, provider: "veo-fast", aspectRatio: "9:16", acceptedCost: 0.8 });
  assert.equal(paid.response.status, 403);
  assert.equal(paid.data.error.code, "YARD_RENDER_GATE");
  const mock = await call("/api/renders", request);
  assert.equal(mock.response.status, 202);
  const yard = await call(`/api/renders?projectId=${YARD_PROJECT_ID}`);
  assert.equal(yard.data.renders.length, 1);
  assert.equal(yard.data.renders[0].projectId, YARD_PROJECT_ID);
  const enemies = await call("/api/renders");
  assert.ok(enemies.data.renders.every((render) => render.projectId !== YARD_PROJECT_ID));
  assert.equal(network.mock.callCount(), 0);
});
test("The Yard permits only one capped PV LTX trial with an opening frame", async (t) => {
  const network = noNetwork(t);
  Object.assign(env, { LTX_LIVE_ENABLED: "true", LTX_API_KEY: "test-key", LTX_FAST_720P_RATE_PER_SECOND_USD: "0.09", RENDER_SESSION_CEILING_USD: "1.2" });
  try {
    const request = body(undefined, {
      projectId: YARD_PROJECT_ID, sceneId: "YARD", shotId: "PV", provider: "ltx-2.5-fast",
      duration: 6, resolution: "720p", aspectRatio: "9:16", acceptedCost: 0.54,
      referenceImages: [{ mimeType: "image/png", data: "iVBORw0KGgo=" }],
      continuity: { ready: true, animaticLocked: true, timingApproved: true, hasCharacters: false },
    });
    const quote = await call("/api/renders", { ...request, estimateOnly: true });
    assert.equal(quote.data.estimatedCost, 0.54);
    const wrongShot = await call("/api/renders", { ...request, shotId: "TSU" });
    assert.equal(wrongShot.data.error.code, "YARD_RENDER_GATE");
    const accepted = await call("/api/renders", request);
    assert.equal(accepted.response.status, 202);
    const second = await call("/api/renders", { ...request, requestKey: crypto.randomUUID() });
    assert.equal(second.response.status, 409);
    const spokespersonFast = await call("/api/renders", { ...request, shotId: "SPK", requestKey: crypto.randomUUID() });
    assert.equal(spokespersonFast.data.error.code, "YARD_RENDER_GATE");
    const canceled = await call(`/api/renders/${accepted.data.render.id}/cancel`, {});
    assert.equal(canceled.data.render.status, "canceled");
    assert.equal(network.mock.callCount(), 0);
  } finally {
    delete env.LTX_LIVE_ENABLED; delete env.LTX_API_KEY; delete env.LTX_FAST_720P_RATE_PER_SECOND_USD;
    env.RENDER_SESSION_CEILING_USD = "0.8";
  }
});
test("The Yard permits one capped portrait TSU LTX Pro trial in its own session", async (t) => {
  const network = noNetwork(t);
  Object.assign(env, {
    LTX_LIVE_ENABLED: "true", LTX_API_KEY: "test-key",
    LTX_FAST_720P_RATE_PER_SECOND_USD: "0.09",
    LTX_PRO_720P_RATE_PER_SECOND_USD: "0.12",
    LTX_PRO_1080P_RATE_PER_SECOND_USD: "0.17",
    RENDER_SESSION_CEILING_USD: "0.8",
  });
  const tsu = body(undefined, {
    projectId: YARD_PROJECT_ID, sceneId: "YARD", shotId: "TSU", provider: "ltx-2.5-pro",
    duration: 6, resolution: "720p", aspectRatio: "9:16", acceptedCost: 0.72,
    referenceImages: [{ mimeType: "image/png", data: "iVBORw0KGgo=" }],
    continuity: { ready: true, animaticLocked: true, timingApproved: true, hasCharacters: false },
  });
  try {
    const quote = await call("/api/renders", { ...tsu, estimateOnly: true });
    assert.equal(quote.data.estimatedCost, 0.72);
    for (const patch of [{ aspectRatio: "16:9" }, { resolution: "1080p", acceptedCost: 1.02 }, { shotId: "LAMAR" }, { provider: "ltx-2.5-fast", acceptedCost: 0.54 }]) {
      const denied = await call("/api/renders", { ...tsu, ...patch, requestKey: crypto.randomUUID() });
      assert.equal(denied.data.error.code, "YARD_RENDER_GATE");
    }
    const accepted = await call("/api/renders", tsu);
    assert.equal(accepted.response.status, 202);
    const row = await env.GENERATION_DB.prepare("SELECT session_id FROM renders WHERE id=?")
      .bind(accepted.data.render.id).first();
    assert.equal(row.session_id, "yard-tsu-pro-first-test");
    const second = await call("/api/renders", { ...tsu, requestKey: crypto.randomUUID() });
    assert.equal(second.response.status, 409);
    assert.equal(network.mock.callCount(), 0);
  } finally {
    delete env.LTX_LIVE_ENABLED;
    delete env.LTX_API_KEY;
    delete env.LTX_FAST_720P_RATE_PER_SECOND_USD;
    delete env.LTX_PRO_720P_RATE_PER_SECOND_USD;
    delete env.LTX_PRO_1080P_RATE_PER_SECOND_USD;
    env.RENDER_SESSION_CEILING_USD = "0.8";
  }
});
test("The Yard quotes capped 1080p portrait Lamar LTX Pro takes and prevents concurrent submissions", async (t) => {
  const network = noNetwork(t);
  Object.assign(env, {
    LTX_LIVE_ENABLED: "true", LTX_API_KEY: "test-key",
    LTX_PRO_720P_RATE_PER_SECOND_USD: "0.12",
    LTX_PRO_1080P_RATE_PER_SECOND_USD: "0.17",
    LTX_FAST_1080P_RATE_PER_SECOND_USD: "0.11",
    RENDER_SESSION_CEILING_USD: "1.10",
    RENDER_PROJECT_CEILING_USD: "20",
  });
  const lamar = body(undefined, {
    projectId: YARD_PROJECT_ID, sceneId: "YARD", shotId: "LAMAR", provider: "ltx-2.5-pro",
    duration: 6, resolution: "1080p", aspectRatio: "9:16", acceptedCost: 1.02,
    referenceImages: [{ mimeType: "image/png", data: "iVBORw0KGgo=" }],
    continuity: { ready: true, animaticLocked: true, timingApproved: true, hasCharacters: false },
  });
  try {
    const quote = await call("/api/renders", { ...lamar, estimateOnly: true });
    assert.equal(quote.data.estimatedCost, 1.02);
    for (const patch of [
      { aspectRatio: "16:9" }, { resolution: "720p", acceptedCost: 0.72 },
      { provider: "ltx-2.5-fast", acceptedCost: 0.66 }, { shotId: "TSU" },
    ]) {
      const denied = await call("/api/renders", { ...lamar, ...patch, requestKey: crypto.randomUUID() });
      assert.equal(denied.data.error.code, "YARD_RENDER_GATE");
    }
    const accepted = await call("/api/renders", lamar);
    assert.equal(accepted.response.status, 202, JSON.stringify(accepted.data));
    const row = await env.GENERATION_DB.prepare("SELECT session_id FROM renders WHERE id=?")
      .bind(accepted.data.render.id).first();
    assert.equal(row.session_id, "yard-lamar-pro-first-test");
    const second = await call("/api/renders", { ...lamar, requestKey: crypto.randomUUID() });
    assert.equal(second.response.status, 409);
    assert.equal(second.data.error.code, "RENDER_IN_PROGRESS");
    assert.equal(network.mock.callCount(), 0);
  } finally {
    delete env.LTX_LIVE_ENABLED;
    delete env.LTX_API_KEY;
    delete env.LTX_PRO_720P_RATE_PER_SECOND_USD;
    delete env.LTX_PRO_1080P_RATE_PER_SECOND_USD;
    delete env.LTX_FAST_1080P_RATE_PER_SECOND_USD;
    env.RENDER_SESSION_CEILING_USD = "0.8";
    env.RENDER_PROJECT_CEILING_USD = "1.6";
  }
});
test("remaining Yard shots allow reviewed retakes across Pro and Google within the project budget", async (t) => {
  const network = noNetwork(t);
  const previous = { ...env };
  Object.assign(env, {
    LIVE_RENDERING_ENABLED: "true", MOCK_E2E_VERIFIED: "true", GEMINI_API_KEY: "fake",
    LTX_LIVE_ENABLED: "true", LTX_API_KEY: "test-key", LTX_PRO_1080P_RATE_PER_SECOND_USD: "0.17",
    RENDER_SESSION_CEILING_USD: "1.10", RENDER_PROJECT_CEILING_USD: "20",
  });
  const base = body(undefined, {
    projectId: YARD_PROJECT_ID, sceneId: "YARD", shotId: "SOUTHERN", provider: "veo-fast",
    duration: 8, resolution: "1080p", aspectRatio: "9:16", acceptedCost: 0.96,
    referenceImages: [{ mimeType: "image/png", data: "iVBORw0KGgo=" }],
    continuity: { ready: true, animaticLocked: true, timingApproved: true, hasCharacters: false },
  });
  try {
    for (const shotId of ["LAMAR", "SOUTHERN", "DRONE", "ALCORN", "SPK"]) {
      const google = await call("/api/renders", { ...base, shotId, estimateOnly: true });
      const pro = await call("/api/renders", {
        ...base, shotId, provider: "ltx-2.5-pro", duration: 6, acceptedCost: 1.02, estimateOnly: true,
      });
      assert.equal(google.data.estimatedCost, 0.96);
      assert.equal(pro.data.estimatedCost, 1.02);
    }
    for (const patch of [
      { duration: 6, acceptedCost: 0.72 }, { resolution: "720p", acceptedCost: 0.8 },
      { aspectRatio: "16:9" }, { referenceImages: [base.referenceImages[0], base.referenceImages[0]] },
      { shotId: "TSU" },
    ]) {
      const denied = await call("/api/renders", { ...base, ...patch, requestKey: crypto.randomUUID() });
      assert.equal(denied.data.error.code, patch.duration === 6 ? "UNSUPPORTED_INPUT" : "YARD_RENDER_GATE");
    }
    const google = await call("/api/renders", base);
    assert.equal(google.response.status, 202, JSON.stringify(google.data));
    const row = await env.GENERATION_DB.prepare("SELECT session_id FROM renders WHERE id=?")
      .bind(google.data.render.id).first();
    assert.equal(row.session_id, "yard-southern-pro-first-test");
    const proRetry = await call("/api/renders", {
      ...base, provider: "ltx-2.5-pro", duration: 6, acceptedCost: 1.02, requestKey: crypto.randomUUID(),
    });
    assert.equal(proRetry.response.status, 409);
    assert.equal(proRetry.data.error.code, "RENDER_IN_PROGRESS");
    await env.GENERATION_DB.prepare("UPDATE renders SET status='failed',reserved_cost=0,actual_cost=0 WHERE id=?")
      .bind(google.data.render.id).run();
    const reviewedRetry = await call("/api/renders", {
      ...base, provider: "ltx-2.5-pro", duration: 6, acceptedCost: 1.02, requestKey: crypto.randomUUID(),
    });
    assert.equal(reviewedRetry.response.status, 202, JSON.stringify(reviewedRetry.data));
    const googleRetry = await call("/api/renders", { ...base, requestKey: crypto.randomUUID() });
    assert.equal(googleRetry.data.error.code, "RENDER_IN_PROGRESS");
    const spokesperson = await call("/api/renders", {
      ...base, shotId: "SPK", provider: "ltx-2.5-pro", duration: 6,
      acceptedCost: 1.02, requestKey: crypto.randomUUID(),
    });
    assert.equal(spokesperson.response.status, 202, JSON.stringify(spokesperson.data));
    assert.equal(network.mock.callCount(), 0);
  } finally {
    Object.assign(env, previous);
    for (const key of ["LIVE_RENDERING_ENABLED", "MOCK_E2E_VERIFIED", "GEMINI_API_KEY", "LTX_LIVE_ENABLED", "LTX_API_KEY", "LTX_PRO_1080P_RATE_PER_SECOND_USD"])
      if (!(key in previous)) delete env[key];
  }
});
test("mock cancel is durable and never paid", async (t) => {
  noNetwork(t);
  let { data } = await call("/api/renders", body());
  const id = data.render.id;
  await call(`/api/renders/${id}`);
  data = (await call(`/api/renders/${id}/cancel`, {})).data;
  assert.equal(data.render.status, "canceled");
  data = (await call(`/api/renders/${id}`)).data;
  assert.equal(data.render.status, "canceled");
  assert.equal(data.render.actualCost, 0);
});
test("failed mock with missing stored references creates no take and no paid spend", async (t) => {
  const network = noNetwork(t);
  const request = body(undefined, {
    referenceImages: [{ mimeType: "image/png", data: "iVBORw0KGgo=" }],
  });
  let r = (await call("/api/renders", request)).data.render;
  // Inject a local storage failure in this isolated test database/bucket.
  await env.GENERATION_MEDIA.delete(`render-inputs/${r.id}.json`);
  r = (await call(`/api/renders/${r.id}`)).data.render;
  assert.equal(r.status, "failed");
  assert.equal(r.error.code, "MISSING_REFERENCES");
  assert.equal(r.actualCost, 0);
  assert.equal(r.reservedCost, 0);
  assert.equal(r.outputAsset, null);
  const state = mergeRender({ project: { id: request.projectId },
    shots: [{ id: "027", scene: "001", takes: [] }], ledger: [] }, r);
  assert.equal(state.shots[0].takes.length, 0);
  assert.equal(state.ledger[0].actualCost, 0);
  assert.equal(network.mock.callCount(), 0);
});
test("atomic session/project ceilings include in-flight and legacy liabilities; duplicate requests reserve once", async (t) => {
  noNetwork(t);
  Object.assign(env, {
    LIVE_RENDERING_ENABLED: "true",
    MOCK_E2E_VERIFIED: "true",
    GEMINI_API_KEY: "fake-test-key",
  });
  const extra = {
    provider: "veo-fast",
    acceptedCost: 0.8,
    continuity: {
      ready: true,
      animaticLocked: true,
      timingApproved: true,
      hasCharacters: false,
    },
  };
  try {
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        call("/api/renders", body(undefined, extra)),
      ),
    );
    assert.equal(outcomes.filter((x) => x.response.status === 202).length, 1);
    assert.equal(outcomes.filter((x) => x.response.status === 409).length, 7);
    const queued = outcomes.find((x) => x.response.status === 202).data.render;
    assert.equal(
      (await call(`/api/renders/${queued.id}/cancel`, {})).data.render.status,
      "canceled",
    );
    env.RENDER_PROJECT_CEILING_USD = "0.4";
    assert.equal(
      (await call("/api/renders", body(undefined, extra))).response.status,
      409,
    );
    env.RENDER_PROJECT_CEILING_USD = "1.6";
    const same = body(undefined, extra);
    const duplicates = await Promise.all(
      Array.from({ length: 4 }, () => call("/api/renders", same)),
    );
    assert.equal(new Set(duplicates.map((x) => x.data.render.id)).size, 1);
    await call(`/api/renders/${duplicates[0].data.render.id}/cancel`, {});
  } finally {
    env.LIVE_RENDERING_ENABLED = "false";
  }
});
test("concurrent reservations cannot exceed the project ceiling even with session headroom", async (t) => {
  const network = noNetwork(t);
  const previous = { ...env };
  Object.assign(env, {
    LIVE_RENDERING_ENABLED: "true", MOCK_E2E_VERIFIED: "true", GEMINI_API_KEY: "fake-test-key",
    RENDER_SESSION_ID: "project-concurrency", RENDER_SESSION_CEILING_USD: "8", RENDER_PROJECT_CEILING_USD: "0.8",
  });
  try {
    // Only reserve and cancel synthetic jobs. Never poll/start a paid provider.
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => call("/api/renders", body(undefined, {
      provider: "veo-fast", acceptedCost: 0.8,
      continuity: { ready: true, animaticLocked: true, timingApproved: true, hasCharacters: false },
    }))));
    assert.equal(outcomes.filter(r => r.response.status === 202).length, 1);
    assert.equal(outcomes.filter(r => r.response.status === 409).length, 7);
    const accepted = outcomes.find(r => r.response.status === 202).data.render;
    assert.equal(accepted.reservedCost, 0.8);
    assert.equal((await call(`/api/renders/${accepted.id}/cancel`, {})).data.render.status, "canceled");
    assert.equal(network.mock.callCount(), 0);
  } finally {
    Object.assign(env, previous);
  }
});
test("Veo adapter maps prompt, reference bytes, duration, aspect, resolution and never fakes cancellation", async () => {
  const calls = [];
  const input = body(undefined, {
    provider: "veo-fast",
    referenceImages: [{ mimeType: "image/png", data: "iVBORw0KGgo=" }],
  });
  const p = createVeoProvider(
    {
      LIVE_RENDERING_ENABLED: "true",
      MOCK_E2E_VERIFIED: "true",
      GEMINI_API_KEY: "fake",
    },
    async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({
        name: "models/veo-3.1-fast-generate-preview/operations/test",
      });
    },
  );
  validateInput(input, p.capabilities);
  const started = await p.start(input);
  assert.match(started.operationId, /operations\/test/);
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(
    payload.instances[0].referenceImages[0].image.inlineData.data,
    input.referenceImages[0].data,
  );
  assert.equal(payload.parameters.durationSeconds, 8);
  assert.equal(payload.parameters.aspectRatio, "16:9");
  assert.equal(payload.parameters.resolution, "720p");
  assert.equal(calls[0].url.includes("fake"), false);
  await assert.rejects(p.cancel({}), /does not guarantee cancellation/);
  assert.throws(
    () => validateInput({ ...input, duration: 6 }, p.capabilities),
    /8-second/,
  );
});
test("Yard Veo uses its single composed still as the initial frame", async () => {
  let payload;
  const p = createVeoProvider({ LIVE_RENDERING_ENABLED: "true", MOCK_E2E_VERIFIED: "true", GEMINI_API_KEY: "fake" },
    async (_url, init) => {
      payload = JSON.parse(init.body);
      return Response.json({ name: "models/veo-3.1-fast-generate-preview/operations/test" });
    });
  await p.start(body(undefined, {
    projectId: YARD_PROJECT_ID, sceneId: "YARD", shotId: "SOUTHERN", provider: "veo-fast",
    referenceImages: [{ mimeType: "image/png", data: "iVBORw0KGgo=" }],
    duration: 8, resolution: "1080p", aspectRatio: "9:16",
  }));
  assert.equal(payload.instances[0].image.inlineData.data, "iVBORw0KGgo=");
  assert.equal(payload.instances[0].referenceImages, undefined);
  assert.equal(payload.parameters.durationSeconds, 8);
  assert.equal(payload.parameters.resolution, "1080p");
});
test("ambiguous Veo start retains reservation and cannot be retried or canceled as free", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("simulated lost response");
  });
  Object.assign(env, {
    LIVE_RENDERING_ENABLED: "true",
    MOCK_E2E_VERIFIED: "true",
    GEMINI_API_KEY: "fake",
  });
  try {
    const { data } = await call(
      "/api/renders",
      body(undefined, {
        provider: "veo-fast",
        acceptedCost: 0.8,
        continuity: { ready: true, animaticLocked: true, timingApproved: true },
      }),
    );
    const id = data.render.id;
    const result = await call(`/api/renders/${id}`);
    assert.equal(result.data.render.status, "uncertain");
    assert.equal(result.data.render.reservedCost, 0.8);
    assert.equal(result.data.render.actualCost, null);
    assert.equal(
      (await call(`/api/renders/${id}/cancel`, {})).response.status,
      409,
    );
    await call(`/api/renders/${id}`);
    assert.equal(globalThis.fetch.mock.callCount(), 1);
  } finally {
    env.LIVE_RENDERING_ENABLED = "false";
  }
});

test("Yard uncertain Google take keeps its reservation and requires explicit acknowledgement for a new paid take", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("simulated lost response"); });
  const previous = { ...env };
  Object.assign(env, {
    LIVE_RENDERING_ENABLED: "true", MOCK_E2E_VERIFIED: "true", GEMINI_API_KEY: "fake",
    RENDER_PROJECT_CEILING_USD: "20", RENDER_SESSION_CEILING_USD: "1.10",
  });
  const request = body(undefined, {
    projectId: YARD_PROJECT_ID, sceneId: "YARD", shotId: "ALCORN", provider: "veo-fast",
    duration: 8, resolution: "1080p", aspectRatio: "9:16", acceptedCost: 0.96,
    referenceImages: [{ mimeType: "image/png", data: "iVBORw0KGgo=" }],
    continuity: { ready: true, animaticLocked: true, timingApproved: true, hasCharacters: false },
  });
  try {
    const first = await call("/api/renders", request);
    assert.equal(first.response.status, 202);
    const id = first.data.render.id;
    const lost = await call(`/api/renders/${id}`);
    assert.equal(lost.data.render.status, "uncertain");
    assert.equal(lost.data.render.reservedCost, 0.96);
    const blocked = await call("/api/renders", { ...request, requestKey: crypto.randomUUID() });
    assert.equal(blocked.data.error.code, "UNCERTAIN_RETRY_ACK");
    const second = await call("/api/renders", {
      ...request, requestKey: crypto.randomUUID(), acknowledgeUncertainRenderId: id,
    });
    assert.equal(second.response.status, 202, JSON.stringify(second.data));
    assert.equal(second.data.render.reservedCost, 0.96);
    const firstStillReserved = await env.GENERATION_DB.prepare("SELECT status,reserved_cost FROM renders WHERE id=?")
      .bind(id).first();
    assert.equal(firstStillReserved.status, "uncertain");
    assert.equal(firstStillReserved.reserved_cost, 0.96);
    assert.equal(globalThis.fetch.mock.callCount(), 1);
  } finally {
    Object.assign(env, previous);
    for (const key of ["LIVE_RENDERING_ENABLED", "MOCK_E2E_VERIFIED", "GEMINI_API_KEY"])
      if (!(key in previous)) delete env[key];
  }
});

test("provider failure releases reservation; completed-but-undownloaded video retains actual charge and retries only retrieval", async (t) => {
  // Separate session avoids the intentionally unresolved job from the previous test.
  Object.assign(env, {
    LIVE_RENDERING_ENABLED: "true",
    MOCK_E2E_VERIFIED: "true",
    GEMINI_API_KEY: "fake",
    RENDER_SESSION_ID: "retrieval-test",
    RENDER_PROJECT_CEILING_USD: "10",
  });
  const network = t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      name: "models/veo-3.1-fast-generate-preview/operations/test",
    }),
  );
  const paid = () =>
    body(undefined, {
      provider: "veo-fast",
      acceptedCost: 0.8,
      continuity: { ready: true, animaticLocked: true, timingApproved: true },
    });
  try {
    let r = (await call("/api/renders", paid())).data.render;
    await call(`/api/renders/${r.id}`);
    network.mock.mockImplementation(async () =>
      Response.json({ done: true, error: { code: 3, message: "not exposed" } }),
    );
    r = (await call(`/api/renders/${r.id}`)).data.render;
    assert.equal(r.status, "failed");
    assert.equal(r.actualCost, 0);
    assert.equal(r.reservedCost, 0);
    network.mock.mockImplementation(async () =>
      Response.json({
        name: "models/veo-3.1-fast-generate-preview/operations/test2",
      }),
    );
    r = (await call("/api/renders", paid())).data.render;
    await call(`/api/renders/${r.id}`);
    network.mock.mockImplementation(async (url) =>
      String(url).includes("/operations/")
        ? Response.json({
            done: true,
            response: {
              generateVideoResponse: {
                generatedSamples: [
                  {
                    video: {
                      uri: "https://generativelanguage.googleapis.com/v1beta/files/test:download",
                    },
                  },
                ],
              },
            },
          })
        : new Response("unavailable", { status: 503 }),
    );
    r = (await call(`/api/renders/${r.id}`)).data.render;
    assert.equal(r.status, "completed");
    assert.equal(r.actualCost, 0.8);
    assert.equal(r.outputAsset, null);
    assert.equal(r.reservedCost, 0);
    assert.equal(r.costBasis, "completed-usage-at-quoted-rate");
    const n = network.mock.callCount();
    await call(`/api/renders/${r.id}`);
    assert.equal(network.mock.callCount(), n + 1);
    // No new operation is started during asset recovery.
    assert.equal(network.mock.calls.at(-1).arguments[1]?.method, undefined);
  } finally {
    env.LIVE_RENDERING_ENABLED = "false";
  }
});

test("reference payloads larger than a D1 row stay in private R2 while render metadata remains small", async (t) => {
  noNetwork(t);
  const image = "iVBORw0K" + "A".repeat(1400000);
  const request = body(undefined, {
    referenceImages: [
      { mimeType: "image/png", data: image },
      { mimeType: "image/png", data: image },
    ],
  });
  const result = await call("/api/renders", request);
  assert.equal(result.response.status, 202);
  const row = await db
    .prepare("SELECT * FROM renders WHERE id=?")
    .bind(result.data.render.id)
    .first();
  assert.ok(row.input_json.length < 2000);
  const stored = await env.GENERATION_MEDIA.get(`render-inputs/${row.id}.json`);
  assert.ok(stored.size > 2000000);
  assert.equal((await stored.json()).referenceImages[0].data, image);
  assert.equal(
    (await call(`/api/renders/${row.id}`)).data.render.status,
    "running",
  );
});

test("legacy D1 paid spend cannot be bypassed by the new render API", async (t) => {
  noNetwork(t);
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO generation_jobs (id,request_hash,project_id,shot_id,route_id,model,resolution,status,actual_cost,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'completed',9.5,?,?)",
    )
    .bind(
      id,
      id,
      "enemies-closer-ep01",
      "027",
      "veo-fast-720",
      "veo",
      "720p",
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
  Object.assign(env, {
    LIVE_RENDERING_ENABLED: "true",
    MOCK_E2E_VERIFIED: "true",
    GEMINI_API_KEY: "fake",
    RENDER_SESSION_ID: "legacy-test",
    RENDER_SESSION_CEILING_USD: "10",
    RENDER_PROJECT_CEILING_USD: "10",
  });
  try {
    const result = await call(
      "/api/renders",
      body(undefined, {
        provider: "veo-fast",
        acceptedCost: 0.8,
        continuity: { ready: true, animaticLocked: true, timingApproved: true },
      }),
    );
    assert.equal(result.response.status, 409);
  } finally {
    env.LIVE_RENDERING_ENABLED = "false";
  }
});
