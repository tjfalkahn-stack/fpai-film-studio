import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import worker from "../worker/index.js";
import { makeJpeg, makePng, makeWebp } from "./imageFixtures.js";

let mf;
let db;
let env;

before(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test");}}',
    d1Databases: ["GENERATION_DB"],
    r2Buckets: ["GENERATION_MEDIA"],
  });
  db = await mf.getD1Database("GENERATION_DB");
  for (const file of ["worker/schema.sql", "worker/render-schema.sql", "worker/character-schema.sql"]) {
    const sql = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/^--.*$/gm, "");
    for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  env = {
    GENERATION_DB: db,
    GENERATION_MEDIA: await mf.getR2Bucket("GENERATION_MEDIA"),
    FPAI_CONTROL_TOKEN: "test",
    LIVE_RENDERING_ENABLED: "false",
    CHARACTER_REFERENCE_SUPPORTING_LIMIT: "5",
  };
});

after(async () => {
  await mf?.dispose();
});

function libraryPath(characterId, rest = "") {
  return `/api/projects/enemies-closer-ep01/characters/${characterId}/references${rest}`;
}

async function call(path, { method = "GET", body, auth = true, headers = {} } = {}) {
  const init = {
    method,
    headers: {
      ...(auth ? { authorization: "Bearer test" } : {}),
      ...headers,
    },
  };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await worker.fetch(new Request(`http://localhost${path}`, init), env);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.arrayBuffer();
  return { response, data };
}

async function upload(characterId, file, fields = {}) {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  return call(libraryPath(characterId), { method: "POST", body: form });
}

function pngFile(name, options) {
  const bytes = makePng(options?.width || 640, options?.height || 640, options);
  return new File([bytes], name, { type: "image/png" });
}

test("unauthorized callers cannot read or write character references", async () => {
  assert.equal((await call(libraryPath("jasmine"), { auth: false })).response.status, 401);
  const denied = await call(libraryPath("jasmine"), { method: "POST", body: new FormData(), auth: false });
  assert.equal(denied.response.status, 401);
});

test("project and character authorization is enforced on every operation", async () => {
  const other = await call("/api/projects/other-project/characters/jasmine/references");
  assert.equal(other.response.status, 403);
  const created = await upload("jasmine", pngFile("auth.png", { salt: "auth" }), { category: "front", angle: "front" });
  assert.equal(created.response.status, 201);
  const id = created.data.reference.id;
  assert.equal(
    (await call(`/api/projects/other-project/characters/jasmine/references/${id}`, { method: "DELETE" })).response.status,
    403,
  );
  assert.equal(
    (await call(libraryPath("turner", `/${id}`))).response.status,
    404,
  );
});

test("bulk upload stores individual original files in R2 and metadata in D1, never collages", async () => {
  const files = Array.from({ length: 8 }, (_, index) =>
    pngFile(`jasmine-${index}.png`, { salt: `bulk-${index}`, r: 40 + index * 10 }),
  );
  const ids = [];
  for (const [index, file] of files.entries()) {
    const result = await upload("jasmine", file, {
      category: index === 0 ? "identity_anchor" : "other",
    });
    assert.equal(result.response.status, 201, result.data.error?.message);
    ids.push(result.data.reference.id);
    assert.equal(result.data.reference.filename.endsWith(".png"), true);
    assert.ok(result.data.reference.assetUrl.includes(result.data.reference.id));
    const object = await env.GENERATION_MEDIA.get(
      `character-refs/enemies-closer-ep01/jasmine/${result.data.reference.id}/${result.data.reference.filename}`,
    );
    assert.ok(object);
    assert.equal(object.httpMetadata.contentType, "image/png");
    assert.equal(object.size, file.size);
  }
  const listed = await call(libraryPath("jasmine"));
  assert.ok(listed.data.references.length >= 8);
  assert.equal(listed.data.references.every((item) => item.id), true);
  const row = await db.prepare("SELECT * FROM character_references WHERE id=?").bind(ids[0]).first();
  assert.equal(row.content_hash.length, 64);
  assert.equal(JSON.parse(row.tags) instanceof Array, true);
  assert.equal(row.r2_key.includes(ids[0]), true);
});

test("duplicate detection uses the content hash and does not create a second object", async () => {
  const file = pngFile("dup.png", { salt: "duplicate-exact" });
  const first = await upload("marcus", file, { category: "identity_anchor", isPrimary: "true" });
  assert.equal(first.response.status, 201);
  const second = await upload("marcus", file, { category: "other" });
  assert.equal(second.response.status, 409);
  assert.equal(second.data.duplicate, true);
  assert.equal(second.data.reference.id, first.data.reference.id);
  const count = await db
    .prepare("SELECT COUNT(*) AS count FROM character_references WHERE character_id=? AND content_hash=?")
    .bind("marcus", first.data.reference.contentHash)
    .first();
  assert.equal(Number(count.count), 1);
});

test("JPEG WebP and invalid files are validated before any character row is written", async () => {
  const beforeCount = await db.prepare("SELECT COUNT(*) AS count FROM character_references WHERE character_id='turner'").first();
  const jpeg = await upload(
    "turner",
    new File([makeJpeg(80, 80, 3)], "turner.jpg", { type: "image/jpeg" }),
    { category: "front" },
  );
  assert.equal(jpeg.response.status, 201);
  const webp = await upload(
    "turner",
    new File([makeWebp(96, 96, 4)], "turner.webp", { type: "image/webp" }),
    { category: "profile", angle: "profile_left" },
  );
  assert.equal(webp.response.status, 201);
  const bad = await upload(
    "turner",
    new File([Buffer.from("hello")], "notes.txt", { type: "text/plain" }),
  );
  assert.equal(bad.response.status, 400);
  const tiny = await upload(
    "turner",
    new File([makePng(16, 16)], "tiny.png", { type: "image/png" }),
  );
  assert.equal(tiny.response.status, 400);
  const afterCount = await db.prepare("SELECT COUNT(*) AS count FROM character_references WHERE character_id='turner'").first();
  assert.equal(Number(afterCount.count), Number(beforeCount.count) + 2);
});

test("only one Primary Identity image can exist and metadata updates persist", async () => {
  const a = await upload("mikey", pngFile("m1.png", { salt: "mikey-1" }), { category: "identity_anchor", isPrimary: "true" });
  const b = await upload("mikey", pngFile("m2.png", { salt: "mikey-2" }), { category: "identity_anchor" });
  assert.equal(a.response.status, 201);
  const promoted = await call(libraryPath("mikey", `/${b.data.reference.id}`), {
    method: "PATCH",
    body: { isPrimary: true, isIdentityAnchor: true, approvalState: "approved" },
  });
  assert.equal(promoted.response.status, 200);
  assert.equal(promoted.data.reference.isPrimary, true);
  const listed = await call(libraryPath("mikey"));
  assert.equal(listed.data.references.filter((item) => item.isPrimary).length, 1);
  assert.equal(listed.data.references.find((item) => item.isPrimary).id, b.data.reference.id);

  const tagged = await call(libraryPath("mikey"), {
    method: "PATCH",
    body: { ids: [a.data.reference.id, b.data.reference.id], patch: { expression: "crying" } },
  });
  assert.equal(tagged.data.references.every((item) => item.expression === "crying"), true);

  const ordered = [b.data.reference.id, a.data.reference.id];
  const reordered = await call(libraryPath("mikey"), { method: "PATCH", body: { orderedIds: ordered } });
  assert.deepEqual(reordered.data.references.map((item) => item.id), ordered);
});

test("deleting a supplemental reference removes R2 bytes without touching other characters or shots", async () => {
  const keep = await upload("marcus", pngFile("keep.png", { salt: "keep-marcus" }), { category: "front" });
  const drop = await upload("marcus", pngFile("drop.png", { salt: "drop-marcus" }), { category: "other" });
  const jasmineBefore = await call(libraryPath("jasmine"));
  const deleted = await call(libraryPath("marcus", `/${drop.data.reference.id}`), { method: "DELETE" });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.data.deleted, true);
  const gone = await env.GENERATION_MEDIA.get(
    `character-refs/enemies-closer-ep01/marcus/${drop.data.reference.id}/${drop.data.reference.filename}`,
  );
  assert.equal(gone, null);
  const still = await call(libraryPath("marcus", `/${keep.data.reference.id}`));
  assert.equal(still.response.status, 200);
  const jasmineAfter = await call(libraryPath("jasmine"));
  assert.equal(jasmineAfter.data.references.length, jasmineBefore.data.references.length);
});

test("existing-image migration helper plus upload creates a Primary Identity without wiping the character", async () => {
  const migrated = await upload("jasmine", pngFile("legacy-front.png", { salt: "legacy-front" }), {
    category: "identity_anchor",
    angle: "front",
    isPrimary: "true",
    isIdentityAnchor: "true",
    approvalState: "approved",
  });
  assert.equal(migrated.response.status, 201);
  assert.equal(migrated.data.reference.isPrimary, true);
  const listed = await call(libraryPath("jasmine"));
  assert.equal(listed.data.references.filter((item) => item.isPrimary).length, 1);
  assert.ok(listed.data.references.length > 1);
});

test("rebuild lock versions the manifest and later edits mark it stale", async () => {
  const rebuilt = await call("/api/projects/enemies-closer-ep01/characters/jasmine/lock", { method: "POST" });
  assert.equal(rebuilt.response.status, 201);
  assert.equal(rebuilt.data.lock.status, "current");
  assert.ok(rebuilt.data.lock.lockVersion >= 1);
  assert.equal(rebuilt.data.lock.characterId, "jasmine");
  assert.ok(rebuilt.data.lock.primaryIdentityAsset?.id);
  const version = rebuilt.data.lock.lockVersion;
  await upload("jasmine", pngFile("after-lock.png", { salt: "after-lock" }), { category: "expression", expression: "crying" });
  const current = await call("/api/projects/enemies-closer-ep01/characters/jasmine/lock");
  assert.equal(current.data.lock.status, "stale");
  assert.equal(current.data.lock.needsRebuild, true);
  assert.equal(current.data.lock.lockVersion, version);
  const again = await call("/api/projects/enemies-closer-ep01/characters/jasmine/lock", { method: "POST" });
  assert.equal(again.data.lock.lockVersion, version + 1);
  assert.ok(current.data.versions.some((item) => item.lockVersion === version));
});

test("deterministic crying selection and single-image provider fallback appear in the mock render payload", async () => {
  await call("/api/projects/enemies-closer-ep01/characters/jasmine/lock", { method: "POST" });
  const quote = await call("/api/renders", {
    method: "POST",
    body: {
      projectId: "enemies-closer-ep01",
      sceneId: "001",
      shotId: "010",
      provider: "mock",
      prompt: "CHAOS · Jasmine crying · Handheld reveal",
      duration: 8,
      resolution: "720p",
      aspectRatio: "16:9",
      referenceImages: [],
      characterIds: ["jasmine"],
      characters: [{ id: "jasmine", name: "Jasmine", wardrobe: "Tarmac Look 01" }],
      shotSubject: "Jasmine crying, medium handheld reveal",
      shotMove: "Handheld reveal",
      estimateOnly: true,
    },
  });
  assert.equal(quote.response.status, 200);
  const selected = quote.data.characterReferenceSelection.selected;
  assert.equal(selected[0].reasons.includes("primary-identity"), true);
  assert.equal(selected.some((item) => item.reasons.some((reason) => reason.includes("crying"))), true);
  assert.equal(quote.data.debug.lockVersions.jasmine >= 1, true);

  const limited = await call("/api/projects/enemies-closer-ep01/characters/jasmine/reference-selection", {
    method: "POST",
    body: {
      shotId: "010",
      subject: "Jasmine crying",
      providerMaxReferences: 1,
    },
  });
  assert.equal(limited.data.selection.transmitted.length, 1);
  assert.equal(limited.data.selection.fallbackApplied, true);

  const render = await call("/api/renders", {
    method: "POST",
    body: {
      projectId: "enemies-closer-ep01",
      sceneId: "001",
      shotId: "010",
      provider: "mock",
      prompt: "CHAOS · Jasmine crying · Handheld reveal",
      duration: 8,
      resolution: "720p",
      aspectRatio: "16:9",
      referenceImages: [],
      characterIds: ["jasmine"],
      characters: [{ id: "jasmine", name: "Jasmine" }],
      shotSubject: "Jasmine crying",
      requestKey: "mock-jasmine-crying-01",
      acceptedCost: 0,
    },
  });
  assert.equal(render.response.status, 202);
  assert.ok(render.data.render.debug.selectedAssetIds.length);
  assert.equal(render.data.render.debug.selectedAssetIds[0], selected[0].assetId);
  const advanced = await call(`/api/renders/${render.data.render.id}`);
  assert.equal(advanced.data.render.status, "running");
  assert.ok(advanced.data.render.debug.characterReferenceSelection);
  assert.equal(Array.isArray(advanced.data.render.debug.selectionReasons), true);
});

test("repeatable character-schema application does not drop existing library rows", async () => {
  const before = await db.prepare("SELECT COUNT(*) AS count FROM character_references").first();
  const sql = readFileSync(new URL("../worker/character-schema.sql", import.meta.url), "utf8").replace(/^--.*$/gm, "");
  for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
  const after = await db.prepare("SELECT COUNT(*) AS count FROM character_references").first();
  assert.equal(Number(after.count), Number(before.count));
  assert.ok(Number(after.count) > 0);
});

test("character factory preflight route stays live-off and fails closed without Comfy", async () => {
  assert.equal((await call("/api/character-factory/preflight", { auth: false })).response.status, 401);
  const { response, data } = await call("/api/character-factory/preflight");
  assert.equal(response.status, 503);
  assert.equal(data.ready, false);
  assert.equal(data.liveGenerationEnabled, false);
  assert.ok(Array.isArray(data.checks));
});
