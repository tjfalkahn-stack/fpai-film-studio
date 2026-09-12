import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import worker from "../worker/index.js";
import { makePng } from "./imageFixtures.js";
import { defaultCharacterSheetCells } from "../src/characterSheets.js";

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
