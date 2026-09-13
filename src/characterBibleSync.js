import { canonicalRefFromAsset, syncCanonicalRefsFromLibrary } from "./characterReferences.js";

export const LEGACY_EXPRESSION_NAMES = Object.freeze([
  "Neutral", "Suspicious", "Controlled Anger", "Hurt", "Paternal", "Exhausted",
]);

export function visibleExpressionNames(expressions = {}) {
  return [...new Set([...LEGACY_EXPRESSION_NAMES, ...Object.keys(expressions)])];
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
  if (payload.sheetExpressions) {
    const expressions = { ...(character.expressions || {}) };
    const sources = { ...(character.sheetExpressionSources || {}) };
    for (const [name, binding] of Object.entries(payload.sheetExpressions)) {
      if (!binding.asset?.id || !binding.sheetId) continue;
      const source = `${binding.sheetId}:${binding.asset.id}`;
      const explicit = payload.applySheetExpressions === binding.sheetId;
      const current = expressions[name];
      const manualTime = Date.parse(current?.uploadedAt || "") || Number(String(current?.key || "").match(/:(\d{13})$/)?.[1]) || 0;
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
    next.expressions = expressions;
    next.sheetExpressionSources = sources;
  }
  return next;
}
