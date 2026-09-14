export const CHARACTER_SHEET_SCHEMA = "fpai.production-character-sheet.v1";
// Keep multipart commits comfortably below the Worker's request/memory limits.
export const MAX_CHARACTER_SHEET_COMMIT_BYTES = 24 * 1024 * 1024;

export const SHEET_EXPRESSION_NAMES = Object.freeze({
  neutral: "Neutral",
  suspicious: "Suspicious",
  controlled_anger: "Controlled Anger",
  hurt: "Hurt",
  maternal: "Maternal",
  paternal: "Paternal",
  concerned: "Concerned",
  exhausted: "Exhausted",
  smiling: "Smiling",
  crying: "Hurt",
  angry: "Controlled Anger",
});

export const CHARACTER_SHEET_LABELS = Object.freeze([
  { key: "identity_front", label: "Identity Front", category: "identity_anchor", angle: "front", canonicalSlot: "identityFront" },
  { key: "three_quarter_left", label: "Left Three-Quarter", category: "three_quarter", angle: "three_quarter_left" },
  { key: "three_quarter_right", label: "Right Three-Quarter", category: "three_quarter", angle: "three_quarter_right" },
  { key: "profile_left", label: "Left Profile", category: "profile", angle: "profile_left", canonicalSlot: "profile" },
  { key: "profile_right", label: "Right Profile", category: "profile", angle: "profile_right", canonicalSlot: "profile" },
  { key: "full_body", label: "Full Body", category: "full_body", angle: "front", canonicalSlot: "fullBody" },
  { key: "neutral", label: "Neutral", category: "expression", expression: "neutral", canonicalSlot: "expression" },
  { key: "suspicious", label: "Suspicious", category: "expression", expression: "suspicious", canonicalSlot: "expression" },
  { key: "controlled_anger", label: "Controlled Anger", category: "expression", expression: "angry", canonicalSlot: "expression" },
  { key: "hurt", label: "Hurt", category: "expression", expression: "crying", canonicalSlot: "expression" },
  { key: "maternal", label: "Maternal", category: "expression", expression: "maternal", canonicalSlot: "expression" },
  { key: "paternal", label: "Paternal", category: "expression", expression: "paternal", canonicalSlot: "expression" },
  { key: "concerned", label: "Concerned", category: "expression", expression: "concerned", canonicalSlot: "expression" },
  { key: "exhausted", label: "Exhausted", category: "expression", expression: "exhausted", canonicalSlot: "expression" },
  { key: "smiling", label: "Smiling", category: "expression", expression: "smiling", canonicalSlot: "expression" },
  { key: "crying", label: "Crying (legacy)", category: "expression", expression: "crying", canonicalSlot: "expression" },
  { key: "angry", label: "Angry (legacy)", category: "expression", expression: "angry", canonicalSlot: "expression" },
  { key: "wardrobe", label: "Wardrobe", category: "wardrobe", canonicalSlot: "wardrobe" },
  { key: "action_pose", label: "Action / Pose", category: "action_pose" },
  { key: "exclude", label: "Exclude", category: "other", excluded: true },
]);

const labelByKey = new Map(CHARACTER_SHEET_LABELS.map((item) => [item.key, item]));
const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export const CUSTOM_CHARACTER_SHEET_LABELS = Object.freeze([
  "identity_front",
  "profile_left",
  "full_body",
  "neutral",
  "wardrobe",
  "three_quarter_left",
  "smiling",
  "crying",
  "angry",
  "action_pose",
]);

export const FPAI_EXPRESSION_BANK_SIZE = 6;
export const MIN_CHARACTER_SHEET_REFERENCE_DIMENSION = 512;

function parentalExpressionKey(character = {}) {
  const id = String(character.id || "").toLowerCase();
  const role = String(character.role || "").toLowerCase();
  if (id === "jasmine" || role.includes("mother") || role.includes("woman")) return "maternal";
  if (id === "marcus" || role.includes("father") || role.includes("kingpin")) return "paternal";
  return "concerned";
}

export function fpaiExpressionLabels(character = {}) {
  return ["neutral", "suspicious", "controlled_anger", "hurt", parentalExpressionKey(character), "exhausted"];
}

// FPAI's authored 5:6 Character Bible has three hero panels, four wardrobe
// panels, then a six-image expression strip. These normalized bounds preserve
// the original source while making every useful panel independently selectable.
export function fpaiCharacterBibleCells(character = {}) {
  const cells = [
    { id: "cell-1", label: "identity_front", x: 0, y: 0, width: 0.5083, height: 0.3836 },
    { id: "cell-2", label: "profile_left", x: 0.5083, y: 0, width: 0.2803, height: 0.3836 },
    { id: "cell-3", label: "full_body", x: 0.7886, y: 0, width: 0.2114, height: 0.3836 },
    { id: "cell-4", label: "wardrobe", x: 0, y: 0.4214, width: 0.1467, height: 0.2489 },
    { id: "cell-5", label: "wardrobe", x: 0.1467, y: 0.4214, width: 0.159, height: 0.2489 },
    { id: "cell-6", label: "wardrobe", x: 0.3057, y: 0.4214, width: 0.1467, height: 0.2489 },
    { id: "cell-7", label: "three_quarter_left", x: 0.4524, y: 0.4214, width: 0.1379, height: 0.2489 },
  ];
  fpaiExpressionLabels(character).forEach((label, index) => {
    cells.push({
      id: `cell-${index + 8}`,
      label,
      x: index / FPAI_EXPRESSION_BANK_SIZE,
      y: 0.7074,
      width: 1 / FPAI_EXPRESSION_BANK_SIZE,
      height: 0.2365,
    });
  });
  return normalizeCharacterSheetCells(cells);
}

export function isFpaiCharacterBibleDimensions(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 900 || h < 1000) return false;
  return Math.abs(w / h - 5 / 6) <= 0.015;
}

export function characterSheetCropPixels(sheet = {}, cell = {}) {
  const source = sheet.manifest?.source || {};
  const sourceWidth = Number(sheet.width || source.width);
  const sourceHeight = Number(sheet.height || source.height);
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return { width: 0, height: 0 };
  return {
    width: Math.max(1, Math.round(sourceWidth * Number(cell.width || 0))),
    height: Math.max(1, Math.round(sourceHeight * Number(cell.height || 0))),
  };
}

export function isLowResolutionExpressionCrop(sheet = {}, cell = {}) {
  if (!SHEET_EXPRESSION_NAMES[cell.label] || cell.included === false) return false;
  return isLowResolutionReferenceCrop(sheet, cell);
}

export function isLowResolutionReferenceCrop(sheet = {}, cell = {}) {
  const preset = labelByKey.get(cell.label);
  if (!preset || preset.excluded || preset.category === "other" || cell.included === false) return false;
  const size = characterSheetCropPixels(sheet, cell);
  if (!size.width || !size.height) return false;
  return Math.min(size.width, size.height) < MIN_CHARACTER_SHEET_REFERENCE_DIMENSION;
}

const acceptedSheetMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function pickCharacterSheetFile(fileList) {
  return [...(fileList || [])].find((file) => {
    if (!file || Number(file.size) <= 0) return false;
    const type = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    return acceptedSheetMimeTypes.has(type) || /\.(jpe?g|png|webp)$/.test(name);
  }) || null;
}

export function normalizeDrawnSheetBounds(start, end, minimumSize = 0.02) {
  if (!start || !end) return null;
  const left = clamp(Math.min(Number(start.x), Number(end.x)));
  const top = clamp(Math.min(Number(start.y), Number(end.y)));
  const right = clamp(Math.max(Number(start.x), Number(end.x)));
  const bottom = clamp(Math.max(Number(start.y), Number(end.y)));
  if (right - left < minimumSize || bottom - top < minimumSize) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function createCustomCharacterSheetCell(cells, bounds, overrides = {}) {
  const current = Array.isArray(cells) ? cells : [];
  if (current.length >= 20) throw new Error("A character sheet can contain at most 20 review panels.");
  const used = new Set(current.map((cell) => cell.id));
  let number = 1;
  while (used.has(`cell-${number}`)) number += 1;
  const cell = {
    id: overrides.id || `cell-${number}`,
    label: overrides.label || CUSTOM_CHARACTER_SHEET_LABELS[current.length % CUSTOM_CHARACTER_SHEET_LABELS.length],
    ...bounds,
    included: overrides.included !== false,
    assetId: null,
  };
  return normalizeCharacterSheetCells([cell])[0];
}

export function defaultCharacterSheetCells(columns = 3, rows = 3) {
  const labels = ["identity_front", "three_quarter_left", "profile_left", "full_body", "neutral", "smiling", "crying", "wardrobe", "action_pose"];
  const cells = [];
  for (let index = 0; index < columns * rows; index += 1) {
    cells.push({
      id: `cell-${index + 1}`,
      label: labels[index] || "action_pose",
      x: (index % columns) / columns,
      y: Math.floor(index / columns) / rows,
      width: 1 / columns,
      height: 1 / rows,
      included: index < labels.length,
      assetId: null,
    });
  }
  return cells;
}

export function normalizeCharacterSheetCells(cells) {
  if (!Array.isArray(cells) || cells.length < 1 || cells.length > 20) throw new Error("A character sheet needs 1 to 20 review panels.");
  const ids = new Set();
  return cells.map((cell, index) => {
    const id = String(cell?.id || `cell-${index + 1}`).slice(0, 80);
    if (ids.has(id)) throw new Error("Character sheet panel IDs must be unique.");
    ids.add(id);
    const label = labelByKey.has(cell?.label) ? cell.label : "action_pose";
    const x = clamp(cell?.x);
    const y = clamp(cell?.y);
    const width = Math.min(1 - x, Math.max(0.01, clamp(cell?.width)));
    const height = Math.min(1 - y, Math.max(0.01, clamp(cell?.height)));
    return {
      id,
      label,
      x,
      y,
      width,
      height,
      included: cell?.included !== false && label !== "exclude",
      assetId: cell?.assetId ? String(cell.assetId) : null,
    };
  });
}

export function referenceFieldsForSheetCell(cell, wardrobe = "") {
  const preset = labelByKey.get(cell.label) || labelByKey.get("action_pose");
  return {
    category: preset.category,
    angle: preset.angle || "",
    expression: preset.expression || "",
    wardrobe: preset.category === "wardrobe" ? String(wardrobe || "").slice(0, 80) : "",
    canonicalSlot: preset.canonicalSlot || "",
    isPrimary: preset.key === "identity_front",
    isIdentityAnchor: ["identity_front", "three_quarter_left", "three_quarter_right", "profile_left", "profile_right"].includes(preset.key),
    approvalState: "approved",
    tags: ["production-character-sheet", `sheet-panel:${cell.id}`, `variant:${preset.key}`],
  };
}

export function buildCharacterSheetManifest({ sheet, cells, committedAt, version }) {
  const normalized = normalizeCharacterSheetCells(cells);
  const included = normalized.filter((cell) => cell.included);
  if (!included.length) throw new Error("Select at least one panel before committing the character sheet.");
  if (included.some((cell) => !cell.assetId)) throw new Error("Every included panel must reference a stored asset before commit.");
  return {
    schema: CHARACTER_SHEET_SCHEMA,
    sheetId: sheet.id,
    projectId: sheet.projectId,
    characterId: sheet.characterId,
    version: Number(version || sheet.version || 1),
    source: {
      filename: sheet.filename,
      contentHash: sheet.contentHash,
      width: sheet.width,
      height: sheet.height,
    },
    panels: included.map((cell) => ({ ...cell, ...referenceFieldsForSheetCell(cell, sheet.wardrobe) })),
    committedAt,
  };
}

// Preferred label order breaks ties; repeated labels use the first reviewed crop.
// A missing slot is deliberately omitted so older assignments survive.
export function canonicalAssignmentsForSheet(panels = []) {
  const slots = {};
  for (const label of CHARACTER_SHEET_LABELS) {
    if (!label.canonicalSlot) continue;
    const panel = panels.find((item) => item.label === label.key && item.included !== false && item.assetId);
    if (panel && !slots[label.canonicalSlot]) slots[label.canonicalSlot] = panel.assetId;
  }
  return slots;
}

export function expressionAssignmentsForSheets(sheets = [], assets = []) {
  const available = new Map(assets.map((asset) => [asset.id, asset]));
  const assignments = {};
  const ordered = [...sheets].filter((sheet) => ["committed", "archived"].includes(sheet.status))
    .sort((a, b) => b.version - a.version || String(a.id).localeCompare(String(b.id)));
  for (const sheet of ordered) {
    for (const panel of sheet.manifest?.panels || []) {
      const name = SHEET_EXPRESSION_NAMES[panel.label];
      const asset = available.get(panel.assetId);
      if (!name || assignments[name] || !asset || panel.included === false) continue;
      assignments[name] = { asset, sheetId: sheet.id, sheetVersion: sheet.version, committedAt: sheet.committedAt || sheet.manifest.committedAt };
    }
  }
  return assignments;
}

export function expressionBankNamesForSheets(sheets = []) {
  const latest = [...sheets]
    .filter((sheet) => sheet.status === "committed")
    .sort((a, b) => b.version - a.version || String(a.id).localeCompare(String(b.id)))[0];
  if (!latest) return [];
  const names = [...new Set((latest.manifest?.panels || []).map((panel) => SHEET_EXPRESSION_NAMES[panel.label]).filter(Boolean))];
  return names.length === FPAI_EXPRESSION_BANK_SIZE ? names : [];
}
