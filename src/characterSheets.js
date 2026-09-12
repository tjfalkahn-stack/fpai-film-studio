export const CHARACTER_SHEET_SCHEMA = "fpai.production-character-sheet.v1";

export const CHARACTER_SHEET_LABELS = Object.freeze([
  { key: "identity_front", label: "Identity Front", category: "identity_anchor", angle: "front", canonicalSlot: "identityFront" },
  { key: "three_quarter_left", label: "Left Three-Quarter", category: "three_quarter", angle: "three_quarter_left" },
  { key: "three_quarter_right", label: "Right Three-Quarter", category: "three_quarter", angle: "three_quarter_right" },
  { key: "profile_left", label: "Left Profile", category: "profile", angle: "profile_left", canonicalSlot: "profile" },
  { key: "profile_right", label: "Right Profile", category: "profile", angle: "profile_right" },
  { key: "full_body", label: "Full Body", category: "full_body", angle: "front", canonicalSlot: "fullBody" },
  { key: "neutral", label: "Neutral", category: "expression", expression: "neutral", canonicalSlot: "expression" },
  { key: "smiling", label: "Smiling", category: "expression", expression: "smiling" },
  { key: "crying", label: "Crying", category: "expression", expression: "crying" },
  { key: "angry", label: "Angry", category: "expression", expression: "angry" },
  { key: "wardrobe", label: "Wardrobe", category: "wardrobe", canonicalSlot: "wardrobe" },
  { key: "action_pose", label: "Action / Pose", category: "action_pose" },
  { key: "exclude", label: "Exclude", category: "other", excluded: true },
]);

const labelByKey = new Map(CHARACTER_SHEET_LABELS.map((item) => [item.key, item]));
const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));

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

