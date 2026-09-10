import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("actual Worker runtime: mock persists across restart, completes and serves seekable MP4", async () => {
  const bundle = await build({
    entryPoints: ["worker/index.js"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  const dir = mkdtempSync(join(tmpdir(), "fpai-render-runtime-"));
  const opts = {
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-08-06",
    d1Databases: { GENERATION_DB: "test-db" },
    r2Buckets: { GENERATION_MEDIA: "test-media" },
    d1Persist: join(dir, "d1"),
    r2Persist: join(dir, "r2"),
    bindings: {
      FPAI_CONTROL_TOKEN: "runtime-test",
      LIVE_RENDERING_ENABLED: "false",
      MOCK_E2E_VERIFIED: "false",
    },
  };
  let mf = new Miniflare(opts);
  const headers = {
    authorization: "Bearer runtime-test",
    "content-type": "application/json",
  };
  try {
    const healthResponse = await mf.dispatchFetch("http://localhost/health");
    assert.equal(healthResponse.status, 200);
    const healthBefore = await healthResponse.json();
    assert.equal(healthBefore.liveExecutionReady, false);
    const catalogResponse = await mf.dispatchFetch("http://localhost/api/renderers", { headers });
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    assert.deepEqual(catalog.providers.map(p => p.id), [
      "mock",
      "comfy-video",
      "seedance-fast",
      "seedance-standard",
      "veo-fast",
    ]);
    assert.equal(catalog.policy.liveEnabled, false);
    assert.equal(catalog.policy.sessionCeiling, 10);
    assert.equal(catalog.policy.projectCeiling, 20);
    let db = await mf.getD1Database("GENERATION_DB");
    for (const file of ["worker/schema.sql", "worker/render-schema.sql", "worker/character-schema.sql"])
      for (const sql of readFileSync(file, "utf8")
        .replace(/^--.*$/gm, "")
        .split(";")
        .filter((s) => s.trim()))
        await db.prepare(sql).run();
    const request = {
      projectId: "enemies-closer-ep01",
      sceneId: "001",
      shotId: "027",
      provider: "mock",
      prompt: "Marcus hero reveal",
      duration: 8,
      resolution: "720p",
      aspectRatio: "16:9",
      referenceImages: [],
      requestKey: crypto.randomUUID(),
      acceptedCost: 0,
    };
    let response = await mf.dispatchFetch("http://localhost/api/renders", {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });
    assert.equal(response.status, 202);
    let render = (await response.json()).render;
    assert.equal(render.status, "queued");
    await mf.dispose();
    mf = new Miniflare(opts);
    response = await mf.dispatchFetch(
      `http://localhost/api/renders/${render.id}`,
      { headers },
    );
    render = (await response.json()).render;
    assert.equal(render.status, "running");
    db = await mf.getD1Database("GENERATION_DB");
    await db
      .prepare("UPDATE renders SET created_at=? WHERE id=?")
      .bind("2020-01-01T00:00:00Z", render.id)
      .run();
    response = await mf.dispatchFetch(
      `http://localhost/api/renders/${render.id}`,
      { headers },
    );
    render = (await response.json()).render;
    assert.equal(render.status, "completed");
    assert.equal(render.actualCost, 0);
    assert.ok(render.outputAsset);
    response = await mf.dispatchFetch(
      `http://localhost${render.outputAsset.url}`,
      { headers: { ...headers, range: "bytes=0-31" } },
    );
    assert.equal(response.status, 206);
    assert.match(
      new TextDecoder().decode(await response.arrayBuffer()),
      /ftyp/,
    );
    const health = await (
      await mf.dispatchFetch("http://localhost/health")
    ).json();
    assert.equal(health.liveExecutionReady, false);
  } finally {
    await mf.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
