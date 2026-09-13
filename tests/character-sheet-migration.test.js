import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import worker from "../worker/index.js";

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
    for (const statement of sql.split(";").map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  await db.prepare("DROP TABLE character_sheets").run();
  env = {
    GENERATION_DB: db,
    GENERATION_MEDIA: await mf.getR2Bucket("GENERATION_MEDIA"),
    FPAI_CONTROL_TOKEN: "test",
    LIVE_RENDERING_ENABLED: "false",
    SEEDANCE_LIVE_ENABLED: "false",
  };
});

after(async () => mf?.dispose());

async function call(path) {
  const response = await worker.fetch(new Request(`http://localhost${path}`, {
    headers: { authorization: "Bearer test" },
  }), env);
  return { response, data: await response.json() };
}

test("an unapplied sheet migration never breaks existing character references", async () => {
  const library = await call("/api/projects/enemies-closer-ep01/characters/jasmine/references");
  assert.equal(library.response.status, 200);
  assert.deepEqual(library.data.references, []);
  assert.equal(library.data.error, undefined);
});

test("sheet routes identify the missing additive migration without hiding the cause", async () => {
  const sheets = await call("/api/projects/enemies-closer-ep01/characters/jasmine/character-sheets");
  assert.equal(sheets.response.status, 503);
  assert.equal(sheets.data.error.code, "CHARACTER_SHEETS_SCHEMA");
  assert.match(sheets.data.error.message, /additive worker\/character-schema\.sql migration/i);
  assert.match(sheets.data.error.message, /preserved/i);
});
