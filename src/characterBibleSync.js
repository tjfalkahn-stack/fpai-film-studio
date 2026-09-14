import {
  MIN_PROVIDER_REFERENCE_DIMENSION,
  canonicalRefFromAsset,
  isCharacterSheetCropReference,
  isUsableProviderReference,
  syncCanonicalRefsFromLibrary,
} from "./characterReferences.js";

export const LEGACY_EXPRESSION_NAMES = Object.freeze([
  "Neutral", "Suspicious", "Controlled Anger", "Hurt", "Paternal", "Exhausted",
]);

const STANDARD_EXPRESSION_NAMES = new Set([
  ...LEGACY_EXPRESSION_NAMES, "Maternal", "Concerned", "Smiling",
]);

const EXPRESSION_NAME_BY_TAG = Object.freeze({
  neutral: "Neutral",
  suspicious: "Suspicious",
  controlled_anger: "Controlled Anger",
  angry: "Controlled Anger",
  hurt: "Hurt",
  crying: "Hurt",
  maternal: "Maternal",
  paternal: "Paternal",
  concerned: "Concerned",
  smiling: "Smiling",
  exhausted: "Exhausted",
});

// Character-sheet panels are useful only when a crop is large enough to be an
// individual provider reference. A 3x3 crop from a 1024px-wide contact sheet,
// for example, is 341px wide and must never replace a full-resolution portrait.
// Missing dimensions remain allowed for migration compatibility with older
// reference rows that predate stored image metadata.
export const MIN_EXPRESSION_REFERENCE_DIMENSION = MIN_PROVIDER_REFERENCE_DIMENSION;

export function isUsableExpressionReference(asset = {}) {
  return isUsableProviderReference(asset);
}

function parentalExpressionName(character = {}) {
  const id = String(character.id || "").toLowerCase();
  const role = String(character.role || "").toLowerCase();
  if (id === "jasmine" || role.includes("mother") || role.includes("woman")) return "Maternal";
  if (id === "marcus" || role.includes("father") || role.includes("kingpin")) return "Paternal";
  return "Concerned";
}

function expressionTime(value = {}) {
  return Date.parse(value.uploadedAt || value.updatedAt || value.updated_at || value.createdAt || value.created_at || "")
    || Number(String(value.key || "").match(/:(\d{13})$/)?.[1])
    || 0;
}

function expressionNameForAsset(asset = {}) {
  const key = String(asset.expression || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return EXPRESSION_NAME_BY_TAG[key] || "";
}

function syncLibraryExpressions(expressions, references, sheetExpressions = {}, explicitNames = new Set()) {
  const candidates = [...(references || [])]
    .filter((asset) => asset.category === "expression" && asset.approvalState !== "excluded" && asset.includeInGeneration !== false && isUsableExpressionReference(asset))
    // Apply generated sheet crops first. A reviewed independent portrait with
    // the same expression then wins even when it was uploaded earlier.
    .sort((a, b) => Number(isCharacterSheetCropReference(b)) - Number(isCharacterSheetCropReference(a))
      || expressionTime(a) - expressionTime(b)
      || Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  for (const asset of candidates) {
    const name = expressionNameForAsset(asset);
    if (!name || explicitNames.has(name) || sheetExpressions[name]?.asset?.id === asset.id) continue;
    const current = expressions[name];
    const independentReplacement = current?.source === "character-sheet" && !isCharacterSheetCropReference(asset);
    if (current && current.source !== "reference-library" && !independentReplacement && expressionTime(current) > expressionTime(asset)) continue;
    expressions[name] = {
      ...canonicalRefFromAsset(asset, "expression"),
      source: "reference-library",
      referenceId: asset.id,
      uploadedAt: asset.updatedAt || asset.createdAt || null,
    };
  }
}

function migrateJasmineLegacyExpressions(character, expressions) {
  if (parentalExpressionName(character) !== "Maternal") return;
  // The old seed exposed Paternal for Jasmine. Preserve its media key while
  // moving the visible assignment to the supported Smiling slot.
  if (!expressions.Smiling && expressions.Paternal) {
    expressions.Smiling = { ...expressions.Paternal, migratedFromExpression: "Paternal" };
  }
}

export function defaultExpressionBankNames(character = {}) {
  const parental = parentalExpressionName(character);
  const names = ["Neutral", "Suspicious", "Controlled Anger", "Hurt", parental, "Exhausted"];
  // Named lead characters use the expanded production bank. The first six
  // still align with the authored Character Bible strip; the final two can be
  // supplied as independent references without changing that sheet format.
  if (parental === "Maternal" || parental === "Paternal") names.push("Concerned", "Smiling");
  return names;
}

export function visibleExpressionNames(expressions = {}, preferredNames = LEGACY_EXPRESSION_NAMES, exactStandardBank = false) {
  const preferred = Array.isArray(preferredNames) && preferredNames.length ? preferredNames : LEGACY_EXPRESSION_NAMES;
  const additional = Object.keys(expressions).filter((name) => !exactStandardBank || !STANDARD_EXPRESSION_NAMES.has(name));
  return [...new Set([...preferred, ...additional])];
}

// Shared by background hydration and the open drawer. Only explicit canonical
// assignments populate required slots; a draft upload never provides them.
export function characterBiblePatch(character, payload = {}) {
  const references = payload.references || (payload.reference
    ? [...(character.referenceLibrary || []).filter((row) => row.id !== payload.reference.id), payload.reference]
    : payload.deletedId
      ? (character.referenceLibrary || []).filter((row) => row.id !== payload.deletedId)
      : character.referenceLibrary);
  const next = {};
  if (payload.migratedMediaKeys) next.migratedMediaKeys = payload.migratedMediaKeys;
  if (payload.lock !== undefined) next.identityLock = payload.lock;
  if (payload.coverage) next.referenceCoverage = payload.coverage;
  if (references) next.referenceLibrary = references;
  if (Object.hasOwn(payload, "canonicalSlots") || payload.references || payload.reference || payload.deletedId) {
    next.refs = syncCanonicalRefsFromLibrary(character, references || [], payload.canonicalSlots || {});
  }
  if (payload.sheetExpressions || payload.references || payload.reference || payload.deletedId) {
    const expressions = { ...(character.expressions || {}) };
    const sources = { ...(character.sheetExpressionSources || {}) };
    const explicitNames = new Set();
    for (const [name, binding] of Object.entries(payload.sheetExpressions || {})) {
      if (!binding.asset?.id || !binding.sheetId) continue;
      const source = `${binding.sheetId}:${binding.asset.id}`;
      const explicit = payload.applySheetExpressions === binding.sheetId;
      if (!isUsableExpressionReference(binding.asset)) {
        // Keep the underlying reference and sheet manifest intact, but remove
        // an unsafe automatic slot assignment so it cannot reach a provider.
        const current = expressions[name];
        if (current?.source === "character-sheet"
          && (current.assetId === binding.asset.id || sources[name] === source)) {
          delete expressions[name];
        }
        if (sources[name] === source) delete sources[name];
        continue;
      }
      if (explicit) explicitNames.add(name);
      const current = expressions[name];
      const manualTime = expressionTime(current);
      if (!explicit && current?.source !== "character-sheet" && manualTime > Date.parse(binding.committedAt || "")) continue;
      // Remember each applied mapping separately from its image. A later manual
      // replacement must survive GET hydration and unrelated library edits.
      if (sources[name] === source && !explicit) continue;
      expressions[name] = {
        ...canonicalRefFromAsset(binding.asset, "expression"),
        source: "character-sheet", sheetId: binding.sheetId, sheetVersion: binding.sheetVersion,
      };
      sources[name] = source;
    }
    syncLibraryExpressions(expressions, references || [], payload.sheetExpressions || {}, explicitNames);
    migrateJasmineLegacyExpressions(character, expressions);
    next.expressions = expressions;
    next.sheetExpressionSources = sources;
  }
  if (Array.isArray(payload.sheetExpressionOrder) && payload.sheetExpressionOrder.length) {
    const parental = parentalExpressionName(character);
    const incompatible = parental === "Maternal" ? "Paternal" : parental === "Paternal" ? "Maternal" : "";
    const sheetOrder = payload.sheetExpressionOrder.filter((name) => name !== incompatible);
    next.expressionBankOrder = [...new Set([...defaultExpressionBankNames(character), ...sheetOrder])];
  }
  return next;
}
