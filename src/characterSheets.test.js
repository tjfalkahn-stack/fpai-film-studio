import test from "node:test";
import assert from "node:assert/strict";
import {
  CHARACTER_SHEET_SCHEMA,
  buildCharacterSheetManifest,
  createCustomCharacterSheetCell,
  defaultCharacterSheetCells,
  expressionBankNamesForSheets,
  fpaiCharacterBibleCells,
  fpaiExpressionLabels,
  isFpaiCharacterBibleDimensions,
  normalizeDrawnSheetBounds,
  normalizeCharacterSheetCells,
  pickCharacterSheetFile,
  referenceFieldsForSheetCell,
} from "./characterSheets.js";
import { buildCharacterLockManifest, shouldInvalidateLock } from "./characterReferences.js";

test("a default production sheet proposes nine reviewable character variants", () => {
  const cells = defaultCharacterSheetCells();
  assert.equal(cells.length, 9);
  assert.equal(cells[0].label, "identity_front");
  assert.equal(cells.some((cell) => cell.label === "crying"), true);
  assert.equal(cells.every((cell) => cell.width === 1 / 3 && cell.height === 1 / 3), true);
});

test("the authored FPAI Bible preset extracts exactly six character-aware expression panels", () => {
  const jasmine = fpaiCharacterBibleCells({ id: "jasmine", role: "Marcus's woman / secret architect" });
  const marcus = fpaiCharacterBibleCells({ id: "marcus", role: "Kingpin / protagonist" });
  const expressions = jasmine.filter((cell) => cell.label === "neutral" || [
    "suspicious", "controlled_anger", "hurt", "maternal", "paternal", "concerned", "exhausted",
  ].includes(cell.label));
  assert.equal(jasmine.length, 13);
  assert.deepEqual(expressions.map((cell) => cell.label), ["neutral", "suspicious", "controlled_anger", "hurt", "maternal", "exhausted"]);
  assert.deepEqual(fpaiExpressionLabels({ id: "marcus" }), ["neutral", "suspicious", "controlled_anger", "hurt", "paternal", "exhausted"]);
  assert.equal(marcus.some((cell) => cell.label === "paternal"), true);
  assert.equal(jasmine.filter((cell) => referenceFieldsForSheetCell(cell).isIdentityAnchor).length, 3);
  assert.equal(jasmine.every((cell) => cell.x >= 0 && cell.y >= 0 && cell.x + cell.width <= 1 && cell.y + cell.height <= 1), true);
  assert.equal(isFpaiCharacterBibleDimensions(1145, 1374), true);
  assert.equal(isFpaiCharacterBibleDimensions(1200, 1200), false);
});

test("expression bank order follows only the current immutable sheet version", () => {
  const names = expressionBankNamesForSheets([
    { id: "old", version: 1, status: "archived", manifest: { panels: [{ label: "smiling" }] } },
    { id: "new", version: 2, status: "committed", manifest: { panels: fpaiCharacterBibleCells({ id: "jasmine" }) } },
  ]);
  assert.deepEqual(names, ["Neutral", "Suspicious", "Controlled Anger", "Hurt", "Maternal", "Exhausted"]);
  assert.deepEqual(expressionBankNamesForSheets([
    { id: "partial", version: 3, status: "committed", manifest: { panels: [{ label: "neutral" }, { label: "smiling" }] } },
  ]), [], "an incomplete sheet must not shrink the visible six-slot bank");
});

test("sheet review normalizes safe crop bounds and rejects duplicate panel ids", () => {
  const [first] = normalizeCharacterSheetCells([{ id: "front", label: "identity_front", x: -1, y: 0, width: 2, height: 0.5 }]);
  assert.deepEqual({ x: first.x, width: first.width }, { x: 0, width: 1 });
  assert.throws(() => normalizeCharacterSheetCells([
    { id: "same", label: "neutral", width: 0.5, height: 0.5 },
    { id: "same", label: "crying", x: 0.5, width: 0.5, height: 0.5 },
  ]), /unique/);
});

test("click and drop file selection accepts supported Character Bible images", () => {
  const png = { name: "jasmine-bible.png", type: "image/png", size: 2048 };
  const extensionOnly = { name: "mikey-bible.WEBP", type: "", size: 1024 };
  assert.equal(pickCharacterSheetFile([{ name: "notes.txt", type: "text/plain", size: 20 }, png]), png);
  assert.equal(pickCharacterSheetFile([extensionOnly]), extensionOnly);
  assert.equal(pickCharacterSheetFile([{ name: "empty.png", type: "image/png", size: 0 }]), null);
});

test("custom Character Bible crops support reverse drawing, safe bounds, and stable labels", () => {
  const bounds = normalizeDrawnSheetBounds({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 });
  assert.deepEqual(bounds, { x: 0.2, y: 0.1, width: 0.6000000000000001, height: 0.6 });
  assert.equal(normalizeDrawnSheetBounds({ x: 0.1, y: 0.1 }, { x: 0.11, y: 0.11 }), null);
  const first = createCustomCharacterSheetCell([], bounds);
  const second = createCustomCharacterSheetCell([first], { x: 0, y: 0, width: 0.2, height: 0.2 });
  assert.equal(first.id, "cell-1");
  assert.equal(first.label, "identity_front");
  assert.equal(second.id, "cell-2");
  assert.equal(second.label, "profile_left");
});

test("reviewed panels map to canonical slots, variants, and an immutable manifest", () => {
  const cells = defaultCharacterSheetCells().slice(0, 2).map((cell, index) => ({ ...cell, assetId: `asset-${index}` }));
  const fields = referenceFieldsForSheetCell(cells[0], "Tarmac Look 01");
  assert.equal(fields.canonicalSlot, "identityFront");
  assert.equal(fields.isPrimary, true);
  assert.equal(fields.tags.includes("variant:identity_front"), true);
  const manifest = buildCharacterSheetManifest({
    sheet: { id: "sheet-1", projectId: "enemies-closer-ep01", characterId: "jasmine", version: 2, filename: "jasmine.png", contentHash: "hash", width: 3000, height: 3000 },
    cells,
    committedAt: "2026-09-12T00:00:00.000Z",
  });
  assert.equal(manifest.schema, CHARACTER_SHEET_SCHEMA);
  assert.equal(manifest.version, 2);
  assert.deepEqual(manifest.panels.map((panel) => panel.assetId), ["asset-0", "asset-1"]);
});

test("character locks retain the committed source-sheet version without becoming immediately stale", () => {
  const source = { id: "sheet-1", version: 2, status: "committed", contentHash: "hash", manifest: { panels: [{ assetId: "asset-1" }] } };
  const lock = buildCharacterLockManifest({ projectId: "enemies-closer-ep01", characterId: "jasmine", lockVersion: 3, assets: [], characterSheets: [source] });
  assert.equal(lock.sourceSheets[0].sheetId, "sheet-1");
  assert.equal(shouldInvalidateLock(lock, [], [source]), false);
  assert.equal(shouldInvalidateLock(lock, [], [{ ...source, version: 3 }]), true);
});
