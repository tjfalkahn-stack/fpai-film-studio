import {
  MAX_REFERENCE_BYTES,
  MIN_UPLOAD_DIMENSION,
  SUFFICIENT_RESOLUTION,
  normalizeMimeType,
} from "./imageMeta.js";

const CANONICAL_REFERENCE_CATEGORIES = [
  { key: "identityFront", legacyKeys: ["masterFace"] },
  { key: "profile" },
  { key: "fullBody" },
  { key: "expression" },
  { key: "wardrobe" },
];

export const CANONICAL_SLOT_KEYS = Object.freeze(
  CANONICAL_REFERENCE_CATEGORIES.map((item) => item.key),
);

export function normalizeCanonicalSlot(value) {
  const key = String(value || "").trim();
  if (CANONICAL_SLOT_KEYS.includes(key)) return key;
  if (key === "masterFace" || key === "identity_front" || key === "identity-front") return "identityFront";
  if (key === "full_body" || key === "full-body") return "fullBody";
  return "";
}

export function canonicalRefFromAsset(asset, slot) {
  const item = normalizeLibraryAsset(asset);
  return {
    key: `library:${item.id}`,
    name: item.filename,
    category: slot,
    source: "canonical",
    canonical: true,
    assetId: item.id,
    assetUrl: item.assetUrl || null,
    uploadedAt: item.createdAt,
  };
}

export function resolveCanonicalSlotMap(assets = [], canonicalSlots = {}) {
  const library = normalizeReferenceLibrary(assets);
  const byId = new Map(library.map((asset) => [asset.id, asset]));
  const resolved = {};
  if (!canonicalSlots || typeof canonicalSlots !== "object" || Array.isArray(canonicalSlots)) {
    return resolved;
  }
  for (const slot of CANONICAL_SLOT_KEYS) {
    const value = canonicalSlots[slot];
    if (!value) continue;
    if (typeof value === "string") {
      const asset = byId.get(value);
      if (asset) resolved[slot] = asset;
      continue;
    }
    if (value.id) {
      resolved[slot] = byId.get(value.id) || normalizeLibraryAsset(value);
    }
  }
  return resolved;
}

export function applyPersistedCanonicalSlots(character = {}, canonicalSlots = {}, assets = []) {
  const resolved = resolveCanonicalSlotMap(
    [
      ...normalizeReferenceLibrary(assets),
      ...Object.values(canonicalSlots || {}).filter((item) => item && typeof item === "object" && item.id),
    ],
    canonicalSlots,
  );
  const refs = { ...(character.refs || {}) };
  for (const slot of CANONICAL_SLOT_KEYS) {
    const asset = resolved[slot];
    if (asset?.id) {
      refs[slot] = canonicalRefFromAsset(asset, slot);
      continue;
    }
    const current = refs[slot];
    if (!current) continue;
    if (current.source === "library" || (String(current.key || "").startsWith("library:") && current.canonical !== true)) {
      delete refs[slot];
    }
  }
  return refs;
}

function nowIso() {
  return new Date().toISOString();
}

function referenceEntry(asset) {
  return asset && asset.key ? asset : null;
}

export const REFERENCE_LIBRARY_SCHEMA = "fpai.character-reference.v1";
export const CHARACTER_LOCK_SCHEMA = "fpai.character-lock.v1";
export const REFERENCE_SELECTION_SCHEMA = "fpai.character-reference-selection.v1";

export const MAX_REFERENCES_PER_CHARACTER = 80;
export const DEFAULT_SUPPORTING_REFERENCE_LIMIT = 5;
export const DEFAULT_ACTIVE_REFERENCE_LIMIT = 1 + DEFAULT_SUPPORTING_REFERENCE_LIMIT;

export const REFERENCE_CATEGORIES = Object.freeze([
  { key: "identity_anchor", label: "Identity Anchor" },
  { key: "face_closeup", label: "Face Close-up" },
  { key: "front", label: "Front Angle" },
  { key: "three_quarter", label: "Three-Quarter Angle" },
  { key: "profile", label: "Profile" },
  { key: "full_body", label: "Full Body" },
  { key: "expression", label: "Expression" },
  { key: "wardrobe", label: "Wardrobe / Look" },
  { key: "action_pose", label: "Action / Pose" },
  { key: "other", label: "Other Supporting" },
]);

export const REFERENCE_ANGLES = Object.freeze([
  { key: "front", label: "Front" },
  { key: "three_quarter_left", label: "Left Three-Quarter" },
  { key: "three_quarter_right", label: "Right Three-Quarter" },
  { key: "profile_left", label: "Left Profile" },
  { key: "profile_right", label: "Right Profile" },
  { key: "other", label: "Other" },
]);

export const EXPRESSION_TAGS = Object.freeze([
  "neutral",
  "smiling",
  "angry",
  "afraid",
  "crying",
  "injured",
  "exhausted",
  "aggressive",
  "custom",
]);

export const APPROVAL_STATES = Object.freeze(["pending", "approved", "excluded"]);

export const LEGACY_SLOT_TO_LIBRARY = Object.freeze({
  identityFront: { category: "identity_anchor", angle: "front", expression: "neutral", primary: true, identityAnchor: true },
  masterFace: { category: "identity_anchor", angle: "front", expression: "neutral", primary: true, identityAnchor: true },
  profile: { category: "profile", angle: "profile_left" },
  fullBody: { category: "full_body", angle: "front" },
  expression: { category: "expression", expression: "neutral" },
  wardrobe: { category: "wardrobe" },
});

const CATEGORY_KEYS = new Set(REFERENCE_CATEGORIES.map((item) => item.key));
const ANGLE_KEYS = new Set(REFERENCE_ANGLES.map((item) => item.key));
const EXPRESSION_KEYS = new Set(EXPRESSION_TAGS);

export function categoryLabel(key) {
  return REFERENCE_CATEGORIES.find((item) => item.key === key)?.label || "Other Supporting";
}

export function normalizeCategory(value, fallback = "other") {
  const key = String(value || "").trim().toLowerCase().replace(/[\s/-]+/g, "_");
  if (CATEGORY_KEYS.has(key)) return key;
  if (key === "identity" || key === "identityfront" || key === "masterface") return "identity_anchor";
  if (key === "face" || key === "closeup" || key === "face_close-ups") return "face_closeup";
  if (key === "threequarter" || key === "three_quarter_left" || key === "three_quarter_right") return "three_quarter";
  if (key === "fullbody") return "full_body";
  if (key === "action" || key === "pose") return "action_pose";
  return CATEGORY_KEYS.has(fallback) ? fallback : "other";
}

export function normalizeAngle(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[\s/-]+/g, "_");
  if (ANGLE_KEYS.has(key)) return key;
  if (key === "left_three_quarter" || key === "l_3_4") return "three_quarter_left";
  if (key === "right_three_quarter" || key === "r_3_4") return "three_quarter_right";
  if (key === "left_profile" || key === "profile") return "profile_left";
  if (key === "right_profile") return "profile_right";
  return "";
}

export function normalizeExpression(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "";
  if (EXPRESSION_KEYS.has(key)) return key;
  if (key === "smile" || key === "happy") return "smiling";
  if (key === "cry" || key === "hurt" || key === "sad") return "crying";
  if (key === "fear" || key === "scared") return "afraid";
  if (key === "mad" || key === "rage") return "angry";
  if (key === "tired") return "exhausted";
  return "custom";
}

export function normalizeApprovalState(value) {
  const key = String(value || "pending").trim().toLowerCase();
  return APPROVAL_STATES.includes(key) ? key : "pending";
}

export function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    if (typeof tags === "string" && tags.trim()) {
      try {
        const parsed = JSON.parse(tags);
        if (Array.isArray(parsed)) return normalizeTags(parsed);
      } catch {
        return [tags.trim().slice(0, 40)];
      }
    }
    return [];
  }
  const seen = new Set();
  const next = [];
  for (const tag of tags) {
    const value = String(tag || "").trim().slice(0, 40);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(value);
    if (next.length >= 12) break;
  }
  return next;
}

export function normalizeLibraryAsset(asset = {}, index = 0) {
  const approvalState = normalizeApprovalState(asset.approvalState ?? asset.approval_state);
  const includeInGeneration =
    asset.includeInGeneration ?? asset.include_in_generation;
  return {
    id: String(asset.id || ""),
    projectId: String(asset.projectId || asset.project_id || ""),
    characterId: String(asset.characterId || asset.character_id || ""),
    r2Key: asset.r2Key || asset.r2_key || "",
    filename: String(asset.filename || "reference").slice(0, 200),
    mimeType: normalizeMimeType(asset.mimeType || asset.mime_type) || "image/jpeg",
    byteSize: Math.max(0, Math.round(Number(asset.byteSize ?? asset.byte_size) || 0)),
    width: Math.max(0, Math.round(Number(asset.width) || 0)),
    height: Math.max(0, Math.round(Number(asset.height) || 0)),
    contentHash: String(asset.contentHash || asset.content_hash || ""),
    category: normalizeCategory(asset.category),
    angle: normalizeAngle(asset.angle),
    expression: normalizeExpression(asset.expression),
    wardrobe: String(asset.wardrobe || "").trim().slice(0, 80),
    tags: normalizeTags(asset.tags),
    approvalState,
    isPrimary: Boolean(Number(asset.isPrimary ?? asset.is_primary)),
    isIdentityAnchor: Boolean(Number(asset.isIdentityAnchor ?? asset.is_identity_anchor)),
    includeInGeneration:
      includeInGeneration == null ? approvalState !== "excluded" : Boolean(Number(includeInGeneration)),
    sortOrder: Number.isFinite(Number(asset.sortOrder ?? asset.sort_order))
      ? Number(asset.sortOrder ?? asset.sort_order)
      : index,
    createdAt: asset.createdAt || asset.created_at || null,
    updatedAt: asset.updatedAt || asset.updated_at || null,
    assetUrl: asset.assetUrl || asset.asset_url || null,
  };
}

export function normalizeReferenceLibrary(assets = []) {
  const normalized = (Array.isArray(assets) ? assets : [])
    .map((asset, index) => normalizeLibraryAsset(asset, index))
    .filter((asset) => asset.id)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  let sawPrimary = false;
  return normalized.map((asset) => {
    if (!asset.isPrimary) return asset;
    if (sawPrimary) return { ...asset, isPrimary: false };
    sawPrimary = true;
    return asset;
  });
}

export function primaryIdentityAsset(assets = []) {
  const library = normalizeReferenceLibrary(assets);
  return library.find((asset) => asset.isPrimary) || null;
}

export function approvedIdentityAnchors(assets = []) {
  return normalizeReferenceLibrary(assets).filter(
    (asset) => asset.isIdentityAnchor && asset.approvalState === "approved" && asset.includeInGeneration,
  );
}

export function generationEligibleAssets(assets = []) {
  return normalizeReferenceLibrary(assets).filter(
    (asset) => asset.approvalState !== "excluded" && asset.includeInGeneration,
  );
}

function hasCategory(assets, key) {
  return assets.some((asset) => asset.category === key && asset.approvalState !== "excluded");
}

function hasAngleFamily(assets, family) {
  return assets.some((asset) => {
    if (asset.approvalState === "excluded") return false;
    if (family === "front") {
      return asset.angle === "front" || asset.category === "front";
    }
    if (family === "three_quarter") {
      return asset.category === "three_quarter" || String(asset.angle).startsWith("three_quarter");
    }
    if (family === "profile") {
      return asset.category === "profile" || String(asset.angle).startsWith("profile");
    }
    return false;
  });
}

function expressionCoverageCount(assets) {
  const found = new Set(
    assets
      .filter((asset) => asset.approvalState !== "excluded" && (asset.category === "expression" || asset.expression))
      .map((asset) => asset.expression || "custom"),
  );
  found.delete("");
  return found.size;
}

function sufficientResolutionCount(assets) {
  return assets.filter(
    (asset) =>
      asset.approvalState !== "excluded" &&
      Math.min(asset.width || 0, asset.height || 0) >= SUFFICIENT_RESOLUTION,
  ).length;
}

function duplicateHashCount(assets) {
  const seen = new Map();
  for (const asset of assets) {
    if (!asset.contentHash) continue;
    seen.set(asset.contentHash, (seen.get(asset.contentHash) || 0) + 1);
  }
  return [...seen.values()].filter((count) => count > 1).length;
}

export const COVERAGE_RULES = Object.freeze([
  {
    id: "primary",
    label: "Primary identity image selected",
    check: (assets) => Boolean(primaryIdentityAsset(assets)),
  },
  {
    id: "anchors",
    label: "At least three approved identity anchors",
    check: (assets) => approvedIdentityAnchors(assets).length >= 3,
  },
  {
    id: "front",
    label: "Front view present",
    check: (assets) => hasAngleFamily(assets, "front"),
  },
  {
    id: "three_quarter",
    label: "Three-quarter view present",
    check: (assets) => hasAngleFamily(assets, "three_quarter"),
  },
  {
    id: "profile",
    label: "Profile view present",
    check: (assets) => hasAngleFamily(assets, "profile"),
  },
  {
    id: "full_body",
    label: "Full-body reference present",
    check: (assets) => hasCategory(assets, "full_body"),
  },
  {
    id: "expression",
    label: "Expression coverage",
    check: (assets) => expressionCoverageCount(assets) >= 3,
  },
  {
    id: "resolution",
    label: "Sufficient image resolution",
    check: (assets) => {
      const primary = primaryIdentityAsset(assets);
      const primaryOk =
        primary && Math.min(primary.width || 0, primary.height || 0) >= SUFFICIENT_RESOLUTION;
      return Boolean(primaryOk) || sufficientResolutionCount(assets) >= 3;
    },
  },
  {
    id: "duplicates",
    label: "No exact duplicate uploads",
    check: (assets) => duplicateHashCount(assets) === 0,
  },
]);

export function evaluateReferenceCoverage(assets = []) {
  const library = normalizeReferenceLibrary(assets);
  const rules = COVERAGE_RULES.map((rule) => {
    const met = rule.check(library);
    return { id: rule.id, label: rule.label, met };
  });
  const metCount = rules.filter((rule) => rule.met).length;
  return {
    schema: REFERENCE_LIBRARY_SCHEMA,
    score: library.length === 0 ? 0 : metCount / rules.length,
    metCount,
    total: rules.length,
    missing: rules.filter((rule) => !rule.met).map((rule) => rule.label),
    rules,
    disclaimer:
      "Reference Coverage is a checklist of uploaded views. It does not guarantee model identity consistency.",
  };
}

export function migrateLegacyCharacterRefs(character = {}, { timestamp = nowIso() } = {}) {
  const refs = character.refs || {};
  const expressions = character.expressions || {};
  const entries = [];
  const usedKeys = new Set();
  const slots = [
    ...CANONICAL_REFERENCE_CATEGORIES.flatMap((category) => [
      category.key,
      ...(category.legacyKeys || []),
    ]),
  ];
  for (const slot of slots) {
    const reference = referenceEntry(refs[slot]);
    if (!reference?.key || usedKeys.has(reference.key)) continue;
    usedKeys.add(reference.key);
    const mapping = LEGACY_SLOT_TO_LIBRARY[slot] || { category: "other" };
    entries.push({
      legacySlot: slot,
      mediaKey: reference.key,
      filename: reference.name || `${slot}.jpg`,
      mimeType: reference.mimeType || "image/jpeg",
      category: mapping.category,
      angle: mapping.angle || "",
      expression: mapping.expression || "",
      wardrobe: slot === "wardrobe" ? character.wardrobe || "" : "",
      isPrimary: Boolean(mapping.primary) && !entries.some((item) => item.isPrimary),
      isIdentityAnchor: Boolean(mapping.identityAnchor || mapping.primary),
      approvalState: "approved",
      includeInGeneration: true,
      createdAt: reference.uploadedAt || timestamp,
    });
  }
  for (const [name, reference] of Object.entries(expressions)) {
    if (!reference?.key || usedKeys.has(reference.key)) continue;
    usedKeys.add(reference.key);
    entries.push({
      legacySlot: `expression:${name}`,
      mediaKey: reference.key,
      filename: reference.name || `${name}.jpg`,
      mimeType: reference.mimeType || "image/jpeg",
      category: "expression",
      angle: "front",
      expression: normalizeExpression(name),
      wardrobe: character.wardrobe || "",
      isPrimary: false,
      isIdentityAnchor: false,
      approvalState: "approved",
      includeInGeneration: true,
      createdAt: timestamp,
    });
  }
  return entries;
}

export function canonicalSlotForLibraryAsset(asset) {
  const item = normalizeLibraryAsset(asset);
  if (item.isPrimary || item.category === "identity_anchor" || item.category === "front") return "identityFront";
  if (item.category === "profile" || String(item.angle).startsWith("profile")) return "profile";
  if (item.category === "full_body") return "fullBody";
  if (item.category === "expression") return "expression";
  if (item.category === "wardrobe") return "wardrobe";
  return null;
}

export function syncCanonicalRefsFromLibrary(character, assets = [], canonicalSlots = null) {
  const library = normalizeReferenceLibrary(assets);
  const explicit = {};
  for (const asset of library) {
    const slot = normalizeCanonicalSlot(asset.canonicalSlot);
    if (slot && !explicit[slot]) explicit[slot] = asset;
  }
  const fromPayload =
    canonicalSlots && typeof canonicalSlots === "object" && !Array.isArray(canonicalSlots)
      ? canonicalSlots
      : null;
  const merged = fromPayload ? { ...explicit, ...fromPayload } : explicit;
  return applyPersistedCanonicalSlots(character, merged, library);
}

export function buildCharacterLockManifest({
  projectId,
  characterId,
  lockVersion,
  assets,
  characterSheets = [],
  createdAt = nowIso(),
}) {
  const library = normalizeReferenceLibrary(assets);
  const primary = primaryIdentityAsset(library);
  const anchors = approvedIdentityAnchors(library);
  const excluded = library.filter((asset) => asset.approvalState === "excluded" || !asset.includeInGeneration);
  const supplemental = library.filter(
    (asset) =>
      asset.id !== primary?.id &&
      !anchors.some((anchor) => anchor.id === asset.id) &&
      asset.approvalState !== "excluded" &&
      asset.includeInGeneration,
  );
  const publicAsset = (asset) => ({
    id: asset.id,
    category: asset.category,
    angle: asset.angle || null,
    expression: asset.expression || null,
    wardrobe: asset.wardrobe || null,
    tags: asset.tags,
    approvalState: asset.approvalState,
    isPrimary: asset.isPrimary,
    isIdentityAnchor: asset.isIdentityAnchor,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    sortOrder: asset.sortOrder,
  });
  return {
    schema: CHARACTER_LOCK_SCHEMA,
    projectId,
    characterId,
    lockVersion: Number(lockVersion) || 1,
    primaryIdentityAsset: primary ? publicAsset(primary) : null,
    approvedIdentityAnchors: anchors.map(publicAsset),
    supplementalReferences: supplemental.map(publicAsset),
    excludedImages: excluded.map(publicAsset),
    categories: Object.fromEntries(
      REFERENCE_CATEGORIES.map((category) => [
        category.key,
        library.filter((asset) => asset.category === category.key).map((asset) => asset.id),
      ]),
    ),
    tags: {
      expressions: Object.fromEntries(
        EXPRESSION_TAGS.map((tag) => [
          tag,
          library.filter((asset) => asset.expression === tag).map((asset) => asset.id),
        ]),
      ),
    },
    sourceSheets: (Array.isArray(characterSheets) ? characterSheets : []).map((sheet) => ({
      sheetId: sheet.id || sheet.sheetId,
      version: Number(sheet.version || 1),
      status: sheet.status || "committed",
      contentHash: sheet.contentHash || sheet.content_hash || null,
      panelAssetIds: (sheet.manifest?.panels || sheet.panels || []).map((panel) => panel.assetId).filter(Boolean),
    })),
    createdAt,
  };
}

export function lockFingerprint(manifest) {
  const relevant = {
    primary: manifest?.primaryIdentityAsset?.id || null,
    anchors: (manifest?.approvedIdentityAnchors || []).map((asset) => asset.id).sort(),
    supplemental: (manifest?.supplementalReferences || []).map((asset) => asset.id).sort(),
    excluded: (manifest?.excludedImages || []).map((asset) => asset.id).sort(),
    categories: manifest?.categories || {},
    tags: manifest?.tags || {},
    sourceSheets: manifest?.sourceSheets || [],
  };
  return JSON.stringify(relevant);
}

export function shouldInvalidateLock(currentManifest, assets, characterSheets = []) {
  if (!currentManifest) return false;
  const next = buildCharacterLockManifest({
    projectId: currentManifest.projectId,
    characterId: currentManifest.characterId,
    lockVersion: currentManifest.lockVersion,
    assets,
    characterSheets,
    createdAt: currentManifest.createdAt,
  });
  return lockFingerprint(currentManifest) !== lockFingerprint(next);
}

const FRAMING_CLOSE = /\b(ecu|extreme close|close-up|close up|closeup|face|portrait|wet eye|eyes?)\b/;
const FRAMING_WIDE = /\b(full[- ]?body|wide|wideshot|establishing|aerial|full shot|long shot)\b/;
const FRAMING_MEDIUM = /\b(medium|cowboy|waist|two-shot|two shot)\b/;

export function inferShotContext(shot = {}, character = {}) {
  const text = `${shot.subject || ""} ${shot.move || ""} ${shot.prompt || ""} ${shot.mode || ""} ${character.name || ""}`.toLowerCase();
  let framing = "medium";
  if (FRAMING_CLOSE.test(text)) framing = "closeup";
  else if (FRAMING_WIDE.test(text)) framing = "wide";
  else if (FRAMING_MEDIUM.test(text)) framing = "medium";

  let angle = "";
  if (/\bprofile\b/.test(text)) angle = "profile";
  else if (/three[- ]quarter|3\/4/.test(text)) angle = "three_quarter";
  else if (/\bfront\b/.test(text)) angle = "front";

  let expression = "";
  for (const tag of EXPRESSION_TAGS) {
    if (tag !== "custom" && text.includes(tag)) {
      expression = tag;
      break;
    }
  }
  if (!expression && /\b(cry|crying|tears|hurt)\b/.test(text)) expression = "crying";
  if (!expression && /\b(smile|smiles|smiling)\b/.test(text)) expression = "smiling";

  const wardrobe = String(shot.wardrobe || character.wardrobe || "").trim();
  const action = /\b(run|running|fight|chase|hold|holding|wounded|injured|action|pose)\b/.test(text);

  return { framing, angle, expression, wardrobe, action };
}

function matchesAngle(asset, angleFamily) {
  if (!angleFamily) return false;
  if (angleFamily === "front") return asset.angle === "front" || asset.category === "front";
  if (angleFamily === "three_quarter") {
    return asset.category === "three_quarter" || String(asset.angle).startsWith("three_quarter");
  }
  if (angleFamily === "profile") {
    return asset.category === "profile" || String(asset.angle).startsWith("profile");
  }
  return asset.angle === angleFamily;
}

function scoreAsset(asset, context) {
  const reasons = [];
  let score = 0;
  if (asset.isPrimary) {
    score += 1000;
    reasons.push("primary-identity");
  }
  if (asset.isIdentityAnchor && asset.approvalState === "approved") {
    score += 120;
    reasons.push("approved-identity-anchor");
  }
  if (context.framing === "closeup" && (asset.category === "face_closeup" || asset.category === "identity_anchor")) {
    score += 90;
    reasons.push("face-closeup-for-close-up");
  }
  if (["medium", "wide"].includes(context.framing) && asset.category === "full_body") {
    score += 88;
    reasons.push(`full-body-for-${context.framing}`);
  }
  if (context.angle && matchesAngle(asset, context.angle)) {
    score += 70;
    reasons.push(`matching-angle:${context.angle}`);
  }
  if (context.expression && asset.expression === context.expression) {
    score += 96;
    reasons.push(`matching-expression:${context.expression}`);
  }
  if (context.wardrobe && asset.wardrobe && asset.wardrobe.toLowerCase() === context.wardrobe.toLowerCase()) {
    score += 60;
    reasons.push("matching-wardrobe");
  } else if (context.wardrobe && asset.category === "wardrobe") {
    score += 35;
    reasons.push("wardrobe-look");
  }
  if (context.action && asset.category === "action_pose") {
    score += 50;
    reasons.push("matching-action-pose");
  }
  if (asset.category === "front" || asset.angle === "front") {
    score += 12;
    if (!reasons.includes("matching-angle:front")) reasons.push("front-view");
  }
  if (Math.min(asset.width || 0, asset.height || 0) >= SUFFICIENT_RESOLUTION) score += 6;
  score += Math.max(0, 20 - Number(asset.sortOrder || 0) * 0.1);
  if (!reasons.length) reasons.push("deterministic-fallback");
  return { score, reasons };
}

function compareRanked(a, b) {
  return b.score - a.score || a.asset.sortOrder - b.asset.sortOrder || a.asset.id.localeCompare(b.asset.id);
}

export function applyProviderReferenceLimit(selected, providerMaxReferences, { preferPrimary = true } = {}) {
  const limit = Number(providerMaxReferences);
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : selected.length;
  const transmitted = selected.slice(0, safeLimit);
  if (preferPrimary && safeLimit === 1) {
    const primary = selected.find((item) => item.reasons?.includes("primary-identity")) || selected[0];
    return {
      transmitted: primary ? [primary] : [],
      fallbackApplied: selected.length > 1,
      providerMaxReferences: safeLimit,
    };
  }
  return {
    transmitted,
    fallbackApplied: selected.length > transmitted.length,
    providerMaxReferences: safeLimit,
  };
}

export function selectGenerationReferences({
  characters = [],
  libraries = {},
  shot = {},
  supportingLimit = DEFAULT_SUPPORTING_REFERENCE_LIMIT,
  providerMaxReferences = null,
  lockVersions = {},
} = {}) {
  const supportingCap = Math.max(0, Math.round(Number(supportingLimit) || 0));
  const selected = [];
  const perCharacter = [];

  for (const character of characters) {
    const characterId = character.id || character.characterId;
    const context = inferShotContext(shot, character);
    const eligible = generationEligibleAssets(libraries[characterId] || []);
    const ranked = eligible
      .map((asset) => {
        const { score, reasons } = scoreAsset(asset, context);
        return { asset, score, reasons, characterId, context };
      })
      .sort(compareRanked);

    const primary = ranked.find((item) => item.asset.isPrimary) || ranked[0] || null;
    const chosen = [];
    if (primary) chosen.push(primary);
    for (const item of ranked) {
      if (chosen.some((entry) => entry.asset.id === item.asset.id)) continue;
      chosen.push(item);
    }
    perCharacter.push({ characterId, context, ranked: chosen, lockVersion: lockVersions[characterId] || null });
  }

  const primaries = [];
  const supporting = [];
  for (const group of perCharacter) {
    const [primary, ...rest] = group.ranked;
    if (primary) {
      primaries.push({
        assetId: primary.asset.id,
        characterId: group.characterId,
        order: 0,
        reasons: primary.reasons,
        category: primary.asset.category,
        expression: primary.asset.expression || null,
        lockVersion: group.lockVersion,
        mimeType: primary.asset.mimeType,
      });
    }
    for (const item of rest) supporting.push({ group, item });
  }

  supporting.sort((a, b) => compareRanked(a.item, b.item) || String(a.group.characterId).localeCompare(b.group.characterId));
  const pickedSupporting = supporting.slice(0, supportingCap).map(({ group, item }) => ({
    assetId: item.asset.id,
    characterId: group.characterId,
    order: 0,
    reasons: item.reasons.length ? item.reasons : ["deterministic-fallback"],
    category: item.asset.category,
    expression: item.asset.expression || null,
    lockVersion: group.lockVersion,
    mimeType: item.asset.mimeType,
  }));

  const combined = [...primaries, ...pickedSupporting].map((item, index) => ({ ...item, order: index + 1 }));
  const provider = applyProviderReferenceLimit(combined, providerMaxReferences ?? combined.length);

  return {
    schema: REFERENCE_SELECTION_SCHEMA,
    shotId: shot.id || null,
    selected: combined,
    transmitted: provider.transmitted,
    omittedFromProvider: combined.filter((item) => !provider.transmitted.some((sent) => sent.assetId === item.assetId)),
    fallbackApplied: provider.fallbackApplied,
    providerMaxReferences: provider.providerMaxReferences,
    supportingLimit: supportingCap,
    lockVersions,
    limitation: provider.fallbackApplied
      ? `The provider accepts at most ${provider.providerMaxReferences} reference image${provider.providerMaxReferences === 1 ? "" : "s"}. The full selected set is preserved in the render manifest; only the transmitted IDs are sent to the provider.`
      : null,
  };
}

export {
  MAX_REFERENCE_BYTES,
  MIN_UPLOAD_DIMENSION,
  SUFFICIENT_RESOLUTION,
};
