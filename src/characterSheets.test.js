import test from "node:test";
import assert from "node:assert/strict";
import {
  CHARACTER_SHEET_SCHEMA,
  buildCharacterSheetManifest,
  defaultCharacterSheetCells,
  normalizeCharacterSheetCells,
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

test("sheet review normalizes safe crop bounds and rejects duplicate panel ids", () => {
  const [first] = normalizeCharacterSheetCells([{ id: "front", label: "identity_front", x: -1, y: 0, width: 2, height: 0.5 }]);
  assert.deepEqual({ x: first.x, width: first.width }, { x: 0, width: 1 });
  assert.throws(() => normalizeCharacterSheetCells([
    { id: "same", label: "neutral", width: 0.5, height: 0.5 },
    { id: "same", label: "crying", x: 0.5, width: 0.5, height: 0.5 },
  ]), /unique/);
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
