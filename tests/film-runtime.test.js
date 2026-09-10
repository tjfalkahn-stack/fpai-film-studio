import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePng } from "./imageFixtures.js";

test("actual D1/R2: source → script → cast locks → mock take → cut → delivery, with restart and concurrency protection", async () => {
  const bundle = await build({
    entryPoints: ["worker/index.js"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  const dir = mkdtempSync(join(tmpdir(), "fpai-film-engine-"));
  let outbound = 0;
  const options = {
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-08-06",
    d1Databases: { GENERATION_DB: "film-db" },
    r2Buckets: { GENERATION_MEDIA: "film-media" },
    d1Persist: join(dir, "d1"),
    r2Persist: join(dir, "r2"),
    bindings: {
      FPAI_CONTROL_TOKEN: "film-test",
      LIVE_RENDERING_ENABLED: "false",
      MOCK_E2E_VERIFIED: "false",
    },
    outboundService: () => {
      outbound++;
      return new Response("External requests are disabled for this test.", {
        status: 502,
      });
    },
  };
  let mf = new Miniflare(options),
    state;
  const base = "http://localhost/api/projects/enemies-closer-ep01/film";
  const headers = { authorization: "Bearer film-test" };
  async function multipart(url, form) {
    const encoded = new Request(url, { method: "POST", headers, body: form });
    return mf.dispatchFetch(url, {
      method: "POST",
      headers: Object.fromEntries(encoded.headers),
      body: new Uint8Array(await encoded.arrayBuffer()),
    });
  }
  async function call(path = "", method = "GET", body) {
    const response =
      body instanceof FormData
        ? await multipart(base + path, body)
        : await mf.dispatchFetch(base + path, {
            method,
            headers: {
              ...headers,
              ...(body ? { "content-type": "application/json" } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
    return { status: response.status, body: await response.json() };
  }
  async function command(command, extra = {}) {
    const packet = {
      requestKey: crypto.randomUUID(),
      expectedRevision: state.revision,
      command,
      ...extra,
    };
    const result = await call("/commands", "POST", packet);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    state = result.body.state;
    return packet;
  }
  async function ref(character, name, metadata = {}) {
    const form = new FormData();
    form.set(
      "file",
      new File([makePng(256, 256, { salt: name })], name + ".png", {
        type: "image/png",
      }),
    );
    for (const [key, value] of Object.entries(metadata))
      form.set(key, String(value));
    const response = await multipart(
      `http://localhost/api/projects/enemies-closer-ep01/characters/${character}/references`,
      form,
    );
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).reference;
  }
  try {
    const db = await mf.getD1Database("GENERATION_DB");
    for (let pass = 0; pass < 2; pass++)
      for (const file of [
        "worker/schema.sql",
        "worker/render-schema.sql",
        "worker/character-schema.sql",
        "worker/film-schema.sql",
      ])
        for (const sql of readFileSync(file, "utf8")
          .replace(/^--.*$/gm, "")
          .split(";")
          .filter((s) => s.trim()))
          await db.prepare(sql).run();
    assert.equal((await mf.dispatchFetch(base)).status, 401);
    assert.equal(
      (
        await mf.dispatchFetch(
          base.replace("enemies-closer-ep01", "another-project"),
          { headers },
        )
      ).status,
      403,
    );
    state = (await call()).body.state;
    const production = {
      project: { id: "enemies-closer-ep01", title: "ENEMIES CLOSER" },
      shots: [
        {
          id: "027",
          scene: "001",
          subject: "Marcus hero reveal",
          duration: 4.5,
          characters: ["marcus"],
          status: "Locked",
        },
        {
          id: "010",
          scene: "001",
          subject: "Jasmine holding Mikey",
          duration: 3,
          characters: ["jasmine", "mikey"],
          status: "Locked",
        },
      ],
    };
    await command({ type: "import-production", production });
    const invalid = new FormData();
    invalid.set(
      "file",
      new File(["not a pdf"], "fake.pdf", { type: "application/pdf" }),
    );
    assert.equal((await call("/sources", "POST", invalid)).status, 400);
    const form = new FormData();
    form.set(
      "file",
      new File(
        [readFileSync("tests/fixtures/enemies-closer-mock.txt")],
        "enemies-closer-mock.txt",
        { type: "text/plain" },
      ),
    );
    form.set("rightsStatus", "owned");
    form.set(
      "provenance",
      "TEST ONLY: adapted from seeded shot subjects. Not the full original screenplay.",
    );
    const uploaded = await call("/sources", "POST", form);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    const source = uploaded.body.source;
    assert.equal(source.source_version, 1);
    assert.equal(source.processing_status, "uploaded");
    const bucket = await mf.getR2Bucket("GENERATION_MEDIA");
    assert.ok(await bucket.head(source.r2_key));
    assert.ok(!JSON.stringify(source).includes("base64"));
    await command({ type: "parse-script", sourceId: source.id });
    assert.equal(state.scripts[0].scenes.length, 2);
    await command({ type: "approve-script", id: state.scripts[0].id });
    const sceneId = state.scripts[0].scenes[0].id;
    await command({ type: "map-shot", id: "010", sceneId });
    await command({ type: "map-shot", id: "027", sceneId });
    await command({ type: "plan-shots" });
    await command({
      type: "add-shot",
      sceneId,
      subject: "Jasmine crying close-up, front angle",
    });
    let shot = state.shots.at(-1);
    await command({
      type: "edit-shot",
      id: shot.id,
      characters: ["jasmine"],
      prompt: "Jasmine crying close-up, front angle",
      duration: 4,
    });
    await command({ type: "review-shot", id: shot.id, status: "approved" });
    const primary = await ref("jasmine", "primary", {
      isPrimary: true,
      category: "identity_anchor",
      angle: "front",
      approvalState: "approved",
    });
    const crying = await ref("jasmine", "crying", {
      category: "expression",
      expression: "crying",
      angle: "front",
      approvalState: "approved",
    });
    await ref("jasmine", "profile", {
      category: "profile",
      angle: "profile_left",
      approvalState: "approved",
    });
    const lock = await mf.dispatchFetch(
      "http://localhost/api/projects/enemies-closer-ep01/characters/jasmine/lock",
      { method: "POST", headers },
    );
    assert.equal(lock.status, 201);
    const preservedReference = await mf.dispatchFetch(
      `http://localhost/api/projects/enemies-closer-ep01/characters/jasmine/references/${primary.id}`,
      { method: "DELETE", headers },
    );
    assert.equal(preservedReference.status, 409);
    await command({
      type: "save-cue",
      sceneId,
      title: "Hold On",
      mood: "Protective urgency",
      sections: {
        verse: "A light remains inside this storm",
        hook: "Hold on, we are going home",
      },
      ownership: "Original test lyrics",
      clearance: "owned",
    });
    await command({
      type: "save-audio",
      id: state.audio.find((a) => a.character === "jasmine").id,
      direction: "Tearful but controlled",
      consent: "permission-recorded",
      voiceProfile: "Test-only consent record",
    });
    const packet = await command({
      type: "create-job",
      shotId: shot.id,
      capability: "video",
      approvedCostCeiling: 0,
    });
    const jobId = state.jobs[0].id;
    const selected = state.jobs[0].selection.selected;
    assert.ok(selected.some((r) => r.assetId === primary.id));
    assert.ok(selected.some((r) => r.assetId === crying.id));
    assert.ok(selected.every((r) => r.reasons.length));
    assert.equal(state.jobs[0].characterLocks.jasmine, 1);
    const replay = await call("/commands", "POST", packet);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.state.jobs.length, 1);
    assert.equal(
      (
        await call("/commands", "POST", {
          ...packet,
          command: { ...packet.command, shotId: "bad" },
        })
      ).status,
      409,
    );
    const badCost = {
      requestKey: crypto.randomUUID(),
      expectedRevision: state.revision,
      command: {
        type: "create-job",
        shotId: shot.id,
        capability: "video",
        approvedCostCeiling: 1,
      },
    };
    assert.equal((await call("/commands", "POST", badCost)).status, 400);
    assert.equal(
      (
        await call("/commands", "POST", {
          ...badCost,
          command: {
            ...badCost.command,
            provider: "veo-fast",
            approvedCostCeiling: 0,
          },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/commands", "POST", {
          ...badCost,
          command: {
            ...badCost.command,
            capability: "unknown",
            approvedCostCeiling: 0,
          },
        })
      ).status,
      400,
    );
    await command({ type: "advance-job", id: jobId });
    assert.equal(state.jobs[0].status, "processing");
    await mf.dispose();
    mf = new Miniflare(options);
    state = (await call()).body.state;
    assert.equal(state.jobs[0].status, "processing");
    await command({ type: "advance-job", id: jobId });
    assert.equal(state.jobs[0].status, "completed");
    assert.equal(state.jobs[0].actualCost, 0);
    const asset = await mf.dispatchFetch(
      "http://localhost" + state.jobs[0].outputAsset,
      { headers },
    );
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "video/mp4");
    assert.match(
      new TextDecoder().decode((await asset.arrayBuffer()).slice(0, 32)),
      /ftyp/,
    );
    await command({ type: "review-job", id: jobId, status: "needs_review" });
    await command({ type: "review-job", id: jobId, status: "approved" });
    await command({ type: "new-cut", name: "Scene 001 test assembly" });
    const cutId = state.cuts[0].id;
    await command({
      type: "place-clip",
      cutId,
      jobId,
      lane: "video",
      in: 1,
      out: 5,
      start: 0,
    });
    await command({
      type: "place-clip",
      cutId,
      lane: "captions",
      caption: "Stay with me.",
      in: 0,
      out: 4,
      start: 0,
    });
    await command({
      type: "review-cut",
      id: cutId,
      notes: "Mock workflow verification only.",
    });
    const pack = await call("/delivery/" + cutId);
    assert.equal(pack.status, 200);
    for (const key of [
      "shotList",
      "productionBible",
      "characterBible",
      "continuity",
      "cueSheet",
      "lyrics",
      "dialogue",
      "captions",
      "audioStemManifest",
      "assetProvenance",
      "rightsReport",
      "costReport",
      "generationHistory",
      "editDecisionList",
      "renderManifest",
    ])
      assert.ok(key in pack.body, key);
    assert.equal(pack.body.masterEncoded, false);
    assert.equal(pack.body.costReport.actual, 0);
    assert.equal(pack.body.renderManifest.duration, 4);
    assert.deepEqual(state.importedProduction, production);
    assert.equal(state.shots.find((s) => s.id === "027").status, "locked");
    await command({
      type: "create-job",
      shotId: shot.id,
      capability: "video",
      approvedCostCeiling: 0,
    });
    const cancelledId = state.jobs.at(-1).id;
    await command({ type: "cancel-job", id: cancelledId });
    assert.equal(state.jobs.at(-1).status, "cancelled");
    assert.equal(state.jobs.at(-1).actualCost, 0);
    const stale = await call("/commands", "POST", {
      requestKey: crypto.randomUUID(),
      expectedRevision: 0,
      command: { type: "new-cut" },
    });
    assert.equal(stale.status, 409);
    const concurrent = await Promise.all(
      [1, 2].map((i) =>
        call("/commands", "POST", {
          requestKey: crypto.randomUUID(),
          expectedRevision: state.revision,
          command: { type: "new-cut", name: `Concurrent ${i}` },
        }),
      ),
    );
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
    const health = await (
      await mf.dispatchFetch("http://localhost/health")
    ).json();
    assert.equal(health.liveRenderingEnabled, false);
    assert.equal(outbound, 0, "No external provider request may run");
    if (process.env.FILM_TEST_REPORT)
      writeFileSync(
        process.env.FILM_TEST_REPORT,
        JSON.stringify(
          {
            result: "passed",
            projectId: state.projectId,
            source: "test fixture adapted from seeded subjects",
            originalProductionPreserved: true,
            selectedReferences: selected,
            deliveryKeys: Object.keys(pack.body),
            cost: pack.body.costReport,
            outboundRequests: outbound,
            liveRenderingEnabled: health.liveRenderingEnabled,
          },
          null,
          2,
        ),
      );
  } finally {
    await mf.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
