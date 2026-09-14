import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import worker from "../worker/index.js";
import { makePng } from "./imageFixtures.js";
import { defaultCharacterSheetCells, fpaiCharacterBibleCells } from "../src/characterSheets.js";
import { characterBiblePatch } from "../src/characterBibleSync.js";
import { characterReferenceCount } from "../src/domain.js";

let mf;
let db;
let env;
const root = "/api/projects/enemies-closer-ep01/characters/jasmine";

before(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test");}}', d1Databases: ["GENERATION_DB"], r2Buckets: ["GENERATION_MEDIA"] });
  db = await mf.getD1Database("GENERATION_DB");
  for (const file of ["worker/schema.sql", "worker/render-schema.sql", "worker/character-schema.sql"]) {
    const sql = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/^--.*$/gm, "");
    for (const statement of sql.split(";").map((value) => value.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  env = { GENERATION_DB: db, GENERATION_MEDIA: await mf.getR2Bucket("GENERATION_MEDIA"), FPAI_CONTROL_TOKEN: "test", LIVE_RENDERING_ENABLED: "false", SEEDANCE_LIVE_ENABLED: "false" };
});

after(async () => mf?.dispose());

async function call(path, { method = "GET", body } = {}) {
  const headers = { authorization: "Bearer test" };
  const init = { method, headers };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  const response = await worker.fetch(new Request(`http://localhost${path}`, init), env);
  const data = await response.json();
  return { response, data };
}

async function uploadReference(name, salt) {
  const form = new FormData();
  form.set("file", new File([makePng(640, 640, { salt })], name, { type: "image/png" }));
  form.set("category", "identity_anchor");
  form.set("approvalState", "approved");
  return call(`${root}/references`, { method: "POST", body: form });
}

test("sheet ingest persists the original source and a correction draft without touching existing characters", async () => {
  const form = new FormData();
  form.set("file", new File([makePng(1200, 1200, { salt: "sheet" })], "jasmine-sheet.png", { type: "image/png" }));
  form.set("cells", JSON.stringify(defaultCharacterSheetCells()));
  const ingested = await call(`${root}/character-sheets`, { method: "POST", body: form });
  assert.equal(ingested.response.status, 201, ingested.data.error?.message);
  assert.equal(ingested.data.sheet.status, "draft");
  assert.equal(ingested.data.sheet.cells.length, 9);
  const object = await env.GENERATION_MEDIA.get(`character-sheets/enemies-closer-ep01/jasmine/${ingested.data.sheet.id}/jasmine-sheet.png`);
  assert.ok(object);
  const oldReferenceCount = await db.prepare("SELECT COUNT(*) AS count FROM character_references WHERE character_id='jasmine'").first();
  assert.equal(Number(oldReferenceCount.count), 0);
});

test("commit API validates stored crop assets, archives older versions, and preserves version manifests", async () => {
  const listed = await call(`${root}/character-sheets`);
  const draft = listed.data.sheets.find((sheet) => sheet.status === "draft");
  const a = await uploadReference("front.png", "sheet-front");
  const b = await uploadReference("crying.png", "sheet-crying");
  const cells = draft.cells.map((cell, index) => ({ ...cell, included: index < 2, assetId: index === 0 ? a.data.reference.id : index === 1 ? b.data.reference.id : null }));
  const corrected = await call(`${root}/character-sheets/${draft.id}`, { method: "PATCH", body: { cells } });
  assert.equal(corrected.response.status, 200);
  const committed = await call(`${root}/character-sheets/${draft.id}/commit`, { method: "POST", body: { cells } });
  assert.equal(committed.response.status, 200, committed.data.error?.message);
  assert.equal(committed.data.sheet.status, "committed");
  assert.deepEqual(committed.data.sheet.manifest.panels.map((panel) => panel.assetId), [a.data.reference.id, b.data.reference.id]);
  const again = await call(`${root}/character-sheets/${draft.id}/commit`, { method: "POST", body: { cells } });
  assert.equal(again.data.idempotent, true);
});

test("all paid and live rendering controls remain disabled", () => {
  assert.equal(env.LIVE_RENDERING_ENABLED, "false");
  assert.equal(env.SEEDANCE_LIVE_ENABLED, "false");
});

async function draftFor(character, salt, cells = defaultCharacterSheetCells()) {
  const path = `/api/projects/enemies-closer-ep01/characters/${character}`;
  const form = new FormData();
  form.set("file", new File([makePng(2400, 2400, { salt })], `${salt}.png`, { type: "image/png" }));
  form.set("cells", JSON.stringify(cells));
  const result = await call(`${path}/character-sheets`, { method: "POST", body: form });
  assert.equal(result.response.status, 201, result.data.error?.message);
  return { path, sheet: result.data.sheet };
}

function cropForm(sheet, salt, { size = 640, invalidLast = false } = {}) {
  const form = new FormData();
  form.set("cells", JSON.stringify(sheet.cells));
  form.set("wardrobe", "Tarmac Look 01");
  const included = sheet.cells.filter((cell) => cell.included);
  included.forEach((cell, index) => {
    const bytes = invalidLast && index === included.length - 1 ? Buffer.from("invalid image") : makePng(size, size, { salt: `${salt}-${cell.id}` });
    form.set(`panel:${cell.id}`, new File([bytes], `${salt}-${cell.id}.png`, { type: "image/png" }));
  });
  return form;
}

test("multipart commit publishes all five required slots, labeled anchors, expression bank, and accurate 9-point coverage together", async () => {
  const { path, sheet } = await draftFor("mikey", "mikey-atomic");
  await call(`${path}/lock`, { method: "POST", body: {} });
  const before = await call(`${path}/references`);
  assert.equal(before.data.references.length, 0);
  assert.equal(before.data.coverage.metCount, 0);
  assert.equal(before.data.coverage.score, 0);
  assert.equal(before.data.lock.status, "current");
  await call(`${path}/character-sheets/${sheet.id}`, { method: "PATCH", body: { cells: sheet.cells } });
  assert.deepEqual((await call(`${path}/references`)).data, before.data, "draft correction must not mutate references or the lock");

  const commit = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: cropForm(sheet, "mikey-atomic") });
  assert.equal(commit.response.status, 200, commit.data.error?.message);
  assert.equal(commit.data.references.length, 9);
  assert.equal(commit.data.coverage.metCount, 9);
  assert.equal(commit.data.coverage.score, 1);
  assert.equal(commit.data.lock.status, "stale");
  assert.equal(commit.data.lock.needsRebuild, true);
  const refsByLabel = Object.fromEntries(commit.data.sheet.manifest.panels.map((panel) => [panel.label, panel.assetId]));
  for (const [slot, label] of Object.entries({ identityFront: "identity_front", profile: "profile_left", fullBody: "full_body", expression: "neutral", wardrobe: "wardrobe" })) {
    assert.equal(commit.data.canonicalSlots[slot].id, refsByLabel[label]);
  }
  const approvedAnchors = commit.data.references.filter((asset) => asset.isIdentityAnchor && asset.approvalState === "approved");
  assert.equal(approvedAnchors.length, 3);
  assert.equal(commit.data.references.filter((asset) => asset.isPrimary).length, 1);
  const ui = characterBiblePatch({ id: "mikey", expressions: { Paternal: { key: "keep-old" } } }, commit.data);
  assert.equal(characterReferenceCount(ui), 5);
  assert.equal(ui.expressions.Neutral.assetId, refsByLabel.neutral);
  assert.equal(ui.expressions.Smiling.assetId, refsByLabel.smiling);
  assert.equal(ui.expressions.Hurt.assetId, refsByLabel.crying);
  assert.equal(ui.expressions.Paternal.key, "keep-old");
  const reloaded = await call(`${path}/references`);
  assert.deepEqual(reloaded.data.canonicalSlots, commit.data.canonicalSlots);
  assert.deepEqual(reloaded.data.sheetExpressions, commit.data.sheetExpressions);
  const rebuilt = await call(`${path}/lock`, { method: "POST", body: {} });
  assert.equal(rebuilt.data.lock.lockVersion, 2);
  assert.equal(rebuilt.data.lock.canonicalSlots.identityFront, refsByLabel.identity_front);
  assert.equal((await call(`${path}/lock`)).data.lock.needsRebuild, false);
  const preservedManifest = commit.data.sheet.manifest;
  const again = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: { cells: [] } });
  assert.equal(again.data.idempotent, true);
  assert.deepEqual(again.data.sheet.manifest, preservedManifest);
  assert.equal(again.data.lock.status, "current");
  for (const table of ["renders", "generation_jobs"]) {
    assert.equal((await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count, 0, "commit/rebuild must never start training or rendering");
  }
});

test("FPAI Bible commit publishes Jasmine's exact six-picture Expression Bank without starting generation", async () => {
  const { path, sheet } = await draftFor("jasmine-expression-bank", "jasmine-six", fpaiCharacterBibleCells({ id: "jasmine" }));
  const result = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: cropForm(sheet, "jasmine-six", { size: 640 }) });
  assert.equal(result.response.status, 200, result.data.error?.message);
  assert.deepEqual(result.data.sheetExpressionOrder, ["Neutral", "Suspicious", "Controlled Anger", "Hurt", "Maternal", "Exhausted"]);
  assert.deepEqual(Object.keys(result.data.sheetExpressions), result.data.sheetExpressionOrder);
  assert.equal(result.data.references.filter((asset) => asset.category === "expression").length, 6);
  assert.equal(result.data.references.filter((asset) => asset.isIdentityAnchor).length, 3);
  assert.equal(result.data.coverage.metCount, 9);
  assert.deepEqual(result.data.coverage.missing, []);
  for (const table of ["renders", "generation_jobs"]) {
    assert.equal((await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count, 0);
  }
});

test("commit rejects undersized sheet crops before publishing slots, expressions, or references", async () => {
  const { path, sheet } = await draftFor("lowres-guard", "lowres-sheet");
  const result = await call(`${path}/character-sheets/${sheet.id}/commit`, {
    method: "POST",
    body: cropForm(sheet, "lowres-sheet", { size: 320 }),
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error.code, "SHEET_CROP_TOO_SMALL");
  assert.match(result.data.error.message, /at least 512×512/);
  const library = await call(`${path}/references`);
  assert.equal(library.data.references.length, 0);
  assert.deepEqual(library.data.canonicalSlots, {});
  assert.equal((await call(`${path}/character-sheets`)).data.sheets[0].status, "draft");
});

test("failed validation and failed transactions cannot partially publish crop refs, slots, expressions, or stale locks", async () => {
  const { path, sheet } = await draftFor("turner", "turner-retry");
  await call(`${path}/lock`, { method: "POST", body: {} });
  const before = (await call(`${path}/references`)).data;
  const invalid = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: cropForm(sheet, "turner-retry", { invalidLast: true }) });
  assert.equal(invalid.response.status, 400);
  assert.deepEqual((await call(`${path}/references`)).data, before);
  const objectsBefore = await env.GENERATION_MEDIA.list({ prefix: "character-refs/enemies-closer-ep01/turner/" });
  env.GENERATION_DB = { prepare: db.prepare.bind(db), batch: () => { throw new Error("Simulated transaction failure"); } };
  try {
    const failed = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: cropForm(sheet, "turner-retry") });
    assert.equal(failed.response.status, 500);
  } finally { env.GENERATION_DB = db; }
  assert.deepEqual((await call(`${path}/references`)).data, before);
  assert.deepEqual((await env.GENERATION_MEDIA.list({ prefix: "character-refs/enemies-closer-ep01/turner/" })).objects, objectsBefore.objects);
  assert.equal((await call(`${path}/character-sheets`)).data.sheets[0].status, "draft");
});

test("a new sheet version preserves previous assets and manifests, fills right-profile/expression fallback, and leaves absent slots alone", async () => {
  const path = "/api/projects/enemies-closer-ep01/characters/mikey";
  const old = (await call(`${path}/character-sheets`)).data.sheets[0];
  const oldSlots = (await call(`${path}/references`)).data.canonicalSlots;
  const cells = defaultCharacterSheetCells().slice(0, 2).map((cell, index) => ({ ...cell, label: index ? "angry" : "profile_right" }));
  const { sheet } = await draftFor("mikey", "mikey-v2", cells);
  const result = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: cropForm(sheet, "mikey-v2", { size: 640 }) });
  assert.equal(result.response.status, 200, result.data.error?.message);
  assert.equal(result.data.references.length, 11);
  assert.equal(result.data.canonicalSlots.profile.angle, "profile_right");
  assert.equal(result.data.canonicalSlots.expression.expression, "angry");
  for (const slot of ["identityFront", "fullBody", "wardrobe"]) assert.deepEqual(result.data.canonicalSlots[slot], oldSlots[slot]);
  assert.ok(result.data.sheetExpressions.Neutral, "unmatched archived neutral remains available");
  assert.ok(result.data.sheetExpressions["Controlled Anger"]);
  const archived = (await call(`${path}/character-sheets`)).data.sheets.find((item) => item.id === old.id);
  assert.equal(archived.status, "archived");
  assert.deepEqual(archived.manifest, old.manifest);
});

test("explicit label repair upgrades an old committed sheet without changing its manifest or ids, and repeated repair is idempotent", async () => {
  const { path, sheet } = await draftFor("marcus", "marcus-repair");
  const initial = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: cropForm(sheet, "marcus-repair") });
  assert.equal(initial.response.status, 200, initial.data.error?.message);
  const manifest = initial.data.sheet.manifest;
  await db.prepare("UPDATE character_references SET category='other', angle='', expression='', is_primary=0, is_identity_anchor=0 WHERE character_id='marcus'").run();
  await db.prepare("DELETE FROM character_canonical_slots WHERE character_id='marcus'").run();
  const before = (await call(`${path}/references`)).data;
  assert.deepEqual(before.canonicalSlots, {}, "GET never silently repairs earlier imports");
  await call(`${path}/lock`, { method: "POST", body: {} });
  const fixed = await call(`${path}/character-sheets/${sheet.id}/apply-labels`, { method: "POST" });
  assert.equal(fixed.response.status, 200, fixed.data.error?.message);
  assert.equal(fixed.data.coverage.metCount, 9);
  assert.equal(Object.keys(fixed.data.canonicalSlots).length, 5);
  assert.equal(fixed.data.lock.status, "stale");
  assert.deepEqual(fixed.data.sheet.manifest, manifest);
  assert.deepEqual(fixed.data.references.map((asset) => asset.id), before.references.map((asset) => asset.id));
  await call(`${path}/lock`, { method: "POST", body: {} });
  const repeated = await call(`${path}/character-sheets/${sheet.id}/apply-labels`, { method: "POST" });
  assert.equal(repeated.data.idempotent, true);
  assert.equal(repeated.data.lock.status, "current");
  assert.equal(repeated.data.applySheetExpressions, sheet.id);
});

test("canonical-only reassignment and duplicate upload reassignment invalidate the manifest lock", async () => {
  const path = "/api/projects/enemies-closer-ep01/characters/marcus";
  const refs = (await call(`${path}/references`)).data.references;
  const profile = refs.find((item) => item.category === "profile");
  const assigned = await call(`${path}/canonical-slots`, { method: "PUT", body: { slot: "identityFront", assetId: profile.id } });
  assert.equal(assigned.data.lock.status, "stale");
  await call(`${path}/lock`, { method: "POST", body: {} });
  const file = new FormData();
  file.set("file", new File([makePng(640, 640, { salt: "marcus-repair-cell-1" })], "reused.png", { type: "image/png" }));
  file.set("canonicalSlot", "identityFront");
  const reused = await call(`${path}/references`, { method: "POST", body: file });
  assert.equal(reused.data.reused, true);
  assert.equal(reused.data.lock.status, "stale");
});

test("commit reuses exact crop bytes and applies reviewed labels without changing the reference id", async () => {
  const { path, sheet } = await draftFor("jasmine", "jasmine-reuse", [{ id: "front", label: "identity_front", x: 0, y: 0, width: 1, height: 1, included: true }]);
  const existing = await uploadReference("reusable.png", "reuse-front");
  const originalId = existing.data.reference.id;
  const form = new FormData();
  form.set("cells", JSON.stringify(sheet.cells));
  form.set("panel:front", new File([makePng(640, 640, { salt: "reuse-front" })], "reusable.png", { type: "image/png" }));
  const count = (await call(`${path}/references`)).data.references.length;
  const result = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: form });
  assert.equal(result.response.status, 200, result.data.error?.message);
  assert.equal(result.data.references.length, count);
  assert.equal(result.data.canonicalSlots.identityFront.id, originalId);
  assert.equal(result.data.canonicalSlots.identityFront.angle, "front");
  assert.equal(result.data.canonicalSlots.identityFront.isPrimary, true);
  assert.equal(result.data.canonicalSlots.identityFront.isIdentityAnchor, true);
});

test("commit fails safely with missing canonical migration and preserves the draft and library", async () => {
  const { path, sheet } = await draftFor("turner", "turner-schema");
  const before = (await call(`${path}/references`)).data;
  await db.prepare("ALTER TABLE character_canonical_slots RENAME TO character_canonical_slots_test_backup").run();
  try {
    const result = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: cropForm(sheet, "turner-schema") });
    assert.equal(result.response.status, 503);
    assert.equal(result.data.error.code, "CANONICAL_SLOTS_SCHEMA");
    assert.equal((await call(`${path}/character-sheets`)).data.sheets[0].status, "draft");
  } finally {
    await db.prepare("ALTER TABLE character_canonical_slots_test_backup RENAME TO character_canonical_slots").run();
  }
  assert.deepEqual((await call(`${path}/references`)).data, before);
});

test("commit rejects cross-character asset ids, repeated crop images, and oversized multipart bodies", async () => {
  const { path, sheet } = await draftFor("turner", "turner-invalid");
  const foreign = (await call(`${root}/references`)).data.references[0];
  const result = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: { cells: [{ ...sheet.cells[0], assetId: foreign.id }] } });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error.code, "INVALID_SHEET_ASSET");
  const form = cropForm(sheet, "turner-invalid");
  form.set("panel:cell-2", form.get("panel:cell-1"));
  const repeated = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: form });
  assert.equal(repeated.data.error.code, "DUPLICATE_SHEET_PANEL");
  const tooLarge = await worker.fetch(new Request(`http://localhost${path}/character-sheets/${sheet.id}/commit`, {
    method: "POST", headers: { authorization: "Bearer test", "content-type": "multipart/form-data; boundary=test", "content-length": String(26 * 1024 * 1024) }, body: "test",
  }), env);
  assert.equal(tooLarge.status, 413);
  assert.equal((await call(`${path}/references`)).data.references.length, 0);
});

test("an ambiguous response after D1 commit never deletes published R2 crops, and retry reads the committed manifest", async () => {
  const { path, sheet } = await draftFor("ambiguous-test", "ambiguous-response", defaultCharacterSheetCells().slice(0, 1));
  env.GENERATION_DB = { prepare: db.prepare.bind(db), batch: async (statements) => {
    await db.batch(statements);
    throw new Error("Simulated lost response after commit");
  } };
  try {
    const response = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: cropForm(sheet, "ambiguous-response") });
    assert.equal(response.response.status, 500);
  } finally { env.GENERATION_DB = db; }
  const retry = await call(`${path}/character-sheets/${sheet.id}/commit`, { method: "POST", body: {} });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.idempotent, true);
  assert.equal(retry.data.references.length, 1);
  const reference = await db.prepare("SELECT r2_key FROM character_references WHERE character_id='ambiguous-test'").first();
  assert.ok(await env.GENERATION_MEDIA.get(reference.r2_key));
});
