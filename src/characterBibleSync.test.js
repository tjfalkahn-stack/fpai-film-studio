import test from "node:test";
import assert from "node:assert/strict";
import {
  characterBiblePatch,
  defaultExpressionBankNames,
  isUsableExpressionReference,
  visibleExpressionNames,
} from "./characterBibleSync.js";
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

test("Jasmine expands a committed six-panel sheet into eight visible production slots without deleting old local images", () => {
  const oldPaternal = { key: "old-paternal" };
  const character = { id: "jasmine", role: "Marcus's woman", expressions: { Paternal: oldPaternal, Custom: { key: "custom" } } };
  const sheetOrder = ["Neutral", "Suspicious", "Controlled Anger", "Hurt", "Maternal", "Exhausted"];
  const order = [...sheetOrder, "Concerned", "Smiling"];
  const patch = characterBiblePatch(character, { sheetExpressions: {}, sheetExpressionOrder: sheetOrder });
  assert.deepEqual(patch.expressionBankOrder, order);
  assert.deepEqual(character.expressions.Paternal, oldPaternal, "the hidden legacy image remains preserved");
  assert.deepEqual(patch.expressions.Smiling, { ...oldPaternal, migratedFromExpression: "Paternal" });
  assert.deepEqual(visibleExpressionNames(character.expressions, patch.expressionBankOrder, true), [...order, "Custom"]);
  assert.deepEqual(defaultExpressionBankNames(character), order);
  assert.equal(defaultExpressionBankNames({ id: "marcus" })[4], "Paternal");
  assert.equal(defaultExpressionBankNames({ id: "marcus" }).length, 8);
});

test("Marcus contact-sheet expressions retain the standard eight-slot production order", () => {
  const character = { id: "marcus", role: "Kingpin / protagonist", expressions: {} };
  const sheetOrder = ["Controlled Anger", "Neutral", "Concerned", "Suspicious", "Exhausted", "Hurt"];
  const patch = characterBiblePatch(character, { sheetExpressions: {}, sheetExpressionOrder: sheetOrder });
  assert.deepEqual(patch.expressionBankOrder, [
    "Neutral", "Suspicious", "Controlled Anger", "Hurt", "Paternal", "Exhausted", "Concerned", "Smiling",
  ]);
});

test("tagged library expressions fill the expanded bank while newer manual replacements survive", () => {
  const character = {
    id: "jasmine",
    role: "Marcus's woman",
    expressions: { Concerned: { key: "manual-concerned", uploadedAt: "2026-09-14T14:10:00Z" } },
  };
  const references = [
    { ...image("concerned"), category: "expression", expression: "concerned", approvalState: "approved", includeInGeneration: true, updatedAt: "2026-09-14T14:00:00Z" },
    { ...image("smile"), category: "expression", expression: "smiling", approvalState: "approved", includeInGeneration: true, updatedAt: "2026-09-14T14:05:00Z" },
    { ...image("excluded"), category: "expression", expression: "neutral", approvalState: "excluded", includeInGeneration: false, updatedAt: "2026-09-14T14:06:00Z" },
  ];
  const patch = characterBiblePatch(character, { references });
  assert.equal(patch.expressions.Concerned.key, "manual-concerned");
  assert.equal(patch.expressions.Smiling.assetId, "smile");
  assert.equal(patch.expressions.Smiling.source, "reference-library");
  assert.equal(patch.expressions.Neutral, undefined);
});

test("deleted server-backed expressions leave the visible bank immediately", () => {
  const character = {
    id: "marcus",
    expressions: {
      Neutral: { key: "library:new-neutral", assetId: "new-neutral", source: "reference-library" },
      Suspicious: { key: "library:old-suspicious", assetId: "old-suspicious", source: "reference-library" },
      Hurt: { key: "library:old-hurt", assetId: "old-hurt", source: "character-sheet", sheetId: "old-sheet" },
      Smiling: { key: "char:marcus:expr:Smiling:1", name: "browser-only.png" },
    },
    sheetExpressionSources: { Hurt: "old-sheet:old-hurt" },
  };
  const patch = characterBiblePatch(character, {
    references: [{
      ...image("new-neutral"), category: "expression", expression: "neutral",
      approvalState: "approved", includeInGeneration: true,
    }],
    canonicalSlots: {},
    sheetExpressions: {},
  });
  assert.equal(patch.expressions.Neutral.assetId, "new-neutral");
  assert.equal(patch.expressions.Suspicious, undefined);
  assert.equal(patch.expressions.Hurt, undefined);
  assert.equal(patch.sheetExpressionSources.Hurt, undefined);
  assert.equal(patch.expressions.Smiling.key, "char:marcus:expr:Smiling:1");
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

test("low-resolution character-sheet crops cannot replace full-resolution individual expression portraits", () => {
  const badSheetCrop = {
    ...image("bad-sheet-neutral"),
    category: "expression",
    expression: "neutral",
    width: 341,
    height: 512,
    tags: ["production-character-sheet", "sheet-panel:cell-5"],
    approvalState: "approved",
    includeInGeneration: true,
    updatedAt: "2026-09-14T16:00:00Z",
  };
  const goodPortrait = {
    ...image("good-neutral"),
    category: "expression",
    expression: "neutral",
    width: 1254,
    height: 1254,
    tags: ["individual-reference"],
    approvalState: "approved",
    includeInGeneration: true,
    updatedAt: "2026-09-14T15:00:00Z",
  };
  const character = {
    id: "marcus",
    expressions: {
      Neutral: {
        assetId: badSheetCrop.id,
        key: `library:${badSheetCrop.id}`,
        source: "character-sheet",
        sheetId: "sheet-2",
      },
    },
    sheetExpressionSources: { Neutral: `sheet-2:${badSheetCrop.id}` },
  };
  const patch = characterBiblePatch(character, {
    references: [badSheetCrop, goodPortrait],
    sheetExpressions: { Neutral: { ...binding(badSheetCrop.id, "sheet-2"), asset: badSheetCrop } },
  });

  assert.equal(isUsableExpressionReference(badSheetCrop), false);
  assert.equal(isUsableExpressionReference(goodPortrait), true);
  assert.equal(patch.expressions.Neutral.assetId, goodPortrait.id);
  assert.equal(patch.expressions.Neutral.source, "reference-library");
  assert.equal(patch.sheetExpressionSources.Neutral, undefined);
  assert.equal(patch.referenceLibrary.length, 2, "both underlying assets remain preserved");
});

test("an invalid sheet-only expression is cleared instead of displaying a collage as a portrait", () => {
  const badSheetCrop = {
    ...image("bad-sheet-smile"),
    category: "expression",
    expression: "smiling",
    width: 341,
    height: 512,
    tags: JSON.stringify(["production-character-sheet", "sheet-panel:cell-6"]),
    approvalState: "approved",
    includeInGeneration: true,
  };
  const character = {
    id: "marcus",
    expressions: { Smiling: { assetId: badSheetCrop.id, source: "character-sheet" } },
    sheetExpressionSources: { Smiling: `sheet-3:${badSheetCrop.id}` },
  };
  const patch = characterBiblePatch(character, {
    references: [badSheetCrop],
    sheetExpressions: { Smiling: { ...binding(badSheetCrop.id, "sheet-3"), asset: badSheetCrop } },
  });

  assert.equal(patch.expressions.Smiling, undefined);
  assert.equal(patch.referenceLibrary[0].id, badSheetCrop.id, "the source media is not deleted");
});
