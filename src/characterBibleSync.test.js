import test from "node:test";
import assert from "node:assert/strict";
import { characterBiblePatch, visibleExpressionNames } from "./characterBibleSync.js";
import { canonicalAssignmentsForSheet, expressionAssignmentsForSheets } from "./characterSheets.js";

const image = (id) => ({ id, filename: `${id}.png`, assetUrl: `/references/${id}/asset` });
const binding = (id, sheetId = "sheet-1") => ({ asset: image(id), sheetId, sheetVersion: 1, committedAt: "2026-09-13T10:00:00Z" });

test("slot selection prefers neutral and left profile, falls back deterministically, and omits missing slots", () => {
  const panels = [
    { label: "crying", assetId: "cry" }, { label: "profile_right", assetId: "right" },
    { label: "neutral", assetId: "neutral-1" }, { label: "neutral", assetId: "neutral-2" },
    { label: "profile_left", assetId: "left" }, { label: "wardrobe", assetId: "excluded", included: false },
  ];
  assert.deepEqual(canonicalAssignmentsForSheet(panels), { profile: "left", expression: "neutral-1" });
  assert.deepEqual(canonicalAssignmentsForSheet(panels.slice(0, 2)), { profile: "right", expression: "cry" });
});

test("drafts never map expressions; newest committed expression wins and archived unmatched expressions survive", () => {
  const sheets = [
    { id: "old", version: 1, status: "archived", manifest: { panels: [{ label: "neutral", assetId: "old" }, { label: "crying", assetId: "cry" }] } },
    { id: "new", version: 2, status: "committed", manifest: { panels: [{ label: "neutral", assetId: "new" }, { label: "smiling", assetId: "smile" }] } },
    { id: "draft", version: 3, status: "draft", manifest: { panels: [{ label: "neutral", assetId: "draft" }] } },
  ];
  const assignments = expressionAssignmentsForSheets(sheets, ["old", "new", "cry", "smile", "draft"].map(image));
  assert.equal(assignments.Neutral.asset.id, "new");
  assert.equal(assignments.Hurt.asset.id, "cry");
  assert.equal(assignments.Smiling.asset.id, "smile");
  assert.equal(assignments.Paternal, undefined);
});

test("the shared UI patch synchronizes committed refs, lock, coverage, and visible legacy expressions without mutating characters", () => {
  const character = {
    id: "jasmine", refs: { wardrobe: { key: "old-wardrobe" } },
    expressions: { Suspicious: { key: "old-suspicious" }, Paternal: { key: "old-paternal" }, Custom: { key: "old-custom" } },
  };
  const before = structuredClone(character);
  const payload = { references: [image("front")], canonicalSlots: { identityFront: "front" },
    sheetExpressions: { Neutral: binding("neutral"), Smiling: binding("smile"), Hurt: binding("cry"), "Controlled Anger": binding("angry") },
    coverage: { metCount: 9, total: 9 }, lock: { status: "stale" } };
  const patch = characterBiblePatch(character, payload);
  assert.deepEqual(character, before);
  assert.equal(patch.id, undefined);
  assert.equal(patch.refs.identityFront.assetId, "front");
  assert.equal(patch.refs.wardrobe.key, "old-wardrobe");
  assert.deepEqual(patch.referenceCoverage, payload.coverage);
  assert.equal(patch.identityLock.status, "stale");
  assert.equal(patch.expressions.Neutral.assetUrl, "/references/neutral/asset");
  for (const name of ["Suspicious", "Paternal", "Custom"]) assert.deepEqual(patch.expressions[name], character.expressions[name]);
  assert.deepEqual(visibleExpressionNames(patch.expressions), ["Neutral", "Suspicious", "Controlled Anger", "Hurt", "Paternal", "Exhausted", "Custom", "Smiling"]);
});

test("later manual expression replacements survive refresh and old payload replay until explicitly reselected", () => {
  const payload = { sheetExpressions: { Neutral: binding("neutral") } };
  let character = { id: "jasmine", ...characterBiblePatch({}, payload) };
  character.expressions.Neutral = { key: "manual", uploadedAt: "2026-09-13T11:00:00Z" };
  assert.equal(characterBiblePatch(character, payload).expressions.Neutral.key, "manual");
  assert.equal(characterBiblePatch({ expressions: character.expressions }, payload).expressions.Neutral.key, "manual");
  const explicitlyApplied = characterBiblePatch(character, { ...payload, applySheetExpressions: "sheet-1" });
  assert.equal(explicitlyApplied.expressions.Neutral.assetId, "neutral");
});

test("partial/draft payloads cannot populate required slots or alter legacy expressions", () => {
  const character = { id: "mikey", refs: { identityFront: { key: "manual-front" } }, expressions: { Neutral: { key: "manual-neutral" } } };
  assert.equal(characterBiblePatch(character, { sheet: { status: "draft" } }).refs, undefined);
  assert.equal(characterBiblePatch(character, { sheet: { status: "draft" } }).expressions, undefined);
});
