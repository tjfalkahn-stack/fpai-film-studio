export const PROJECT_ID = "enemies-closer-ep01";
export const OWNER_ID = "owner";

export const CANONICAL_REFERENCE_CATEGORIES = [
  { key: "identityFront", label: "Identity / Front", required: true, legacyKeys: ["masterFace"] },
  { key: "profile", label: "Profile", required: true },
  { key: "fullBody", label: "Full Body", required: true },
  { key: "expression", label: "Expression", required: true },
  { key: "wardrobe", label: "Wardrobe", required: true },
];

export const GENERATION_TYPES = {
  CHARACTER_REFERENCE: "character/reference generation",
  PREVIEW: "preview generation",
  FINAL_IMAGE: "final image generation",
  VIDEO: "video generation",
  RETRY: "regeneration/retry",
  UPSCALE: "upscale/enhancement",
};

export const GENERATION_STATUSES = ["planned", "queued", "running", "completed", "failed", "canceled"];
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "not_applicable"];

export function nowIso() {
  return new Date().toISOString();
}

export function referenceEntry(asset) {
  return asset && asset.key ? asset : null;
}

export function normalizeCharacterRefs(refs = {}) {
  return CANONICAL_REFERENCE_CATEGORIES.reduce((next, category) => {
    const current = referenceEntry(refs[category.key]);
    const legacy = category.legacyKeys?.map((key) => referenceEntry(refs[key])).find(Boolean);
    if (current || legacy) next[category.key] = current || legacy;
    return next;
  }, { ...refs });
}

export function characterReferenceCount(character) {
  return CANONICAL_REFERENCE_CATEGORIES.filter((category) =>
    Boolean(referenceEntry(character?.refs?.[category.key]))
  ).length;
}

export function missingReferenceCategories(character) {
  return CANONICAL_REFERENCE_CATEGORIES.filter((category) => !referenceEntry(character?.refs?.[category.key]));
}

export function isCharacterReferenceComplete(character) {
  return missingReferenceCategories(character).length === 0;
}

export function normalizeCharacter(character) {
  const normalized = { ...character, refs: normalizeCharacterRefs(character.refs), expressions: character.expressions || {} };
  return { ...normalized, locked: Boolean(character.locked && isCharacterReferenceComplete(normalized)) };
}

export function mergeSavedCharacters(saved = [], seedCharacters = []) {
  const savedList = Array.isArray(saved) ? saved : [];
  const seedList = Array.isArray(seedCharacters) ? seedCharacters : [];
  const savedById = new Map(savedList.map((character) => [character.id, character]));
  const result = [];
  const seen = new Set();
  for (const seedCharacter of seedList) {
    const savedCharacter = savedById.get(seedCharacter.id);
    if (!savedCharacter) {
      result.push(normalizeCharacter(seedCharacter));
      continue;
    }
    seen.add(seedCharacter.id);
    result.push(
      normalizeCharacter({
        ...seedCharacter,
        ...savedCharacter,
        refs: savedCharacter.refs != null ? savedCharacter.refs : {},
        expressions: savedCharacter.expressions != null ? savedCharacter.expressions : seedCharacter.expressions || {},
      }),
    );
  }
  for (const savedCharacter of savedList) {
    if (!seen.has(savedCharacter.id)) result.push(normalizeCharacter(savedCharacter));
  }
  return result;
}

export function normalizeBudget(project = {}, timestamp = nowIso()) {
  if (project.productionBudget) {
    const original = Number(project.productionBudget.original ?? project.productionBudget.current ?? project.budget ?? 1200);
    const current = Number(project.productionBudget.current ?? original);
    return {
      original,
      current,
      locked: Boolean(project.productionBudget.locked),
      lockedAt: project.productionBudget.lockedAt || null,
      history: Array.isArray(project.productionBudget.history) ? project.productionBudget.history : [],
    };
  }

  const value = Number(project.budget ?? 1200);
  return {
    original: value,
    current: value,
    locked: false,
    lockedAt: null,
    history: [],
    migratedAt: timestamp,
  };
}

export function validateBudgetAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error("Budget must be a valid non-negative amount.");
  return Math.round(value * 100) / 100;
}

export function setProductionBudget(project, amount) {
  const value = validateBudgetAmount(amount);
  const existing = normalizeBudget(project);
  const original = existing.history.length || existing.lockedAt ? existing.original : value;
  return {
    ...project,
    productionBudget: {
      ...existing,
      original,
      current: value,
    },
  };
}

export function lockProductionBudget(project, timestamp = nowIso()) {
  const existing = normalizeBudget(project, timestamp);
  return {
    ...project,
    productionBudget: {
      ...existing,
      locked: true,
      lockedAt: existing.lockedAt || timestamp,
    },
  };
}

export function adjustProductionBudget(project, amount, note = "", actor = OWNER_ID, timestamp = nowIso()) {
  const value = validateBudgetAmount(amount);
  const existing = normalizeBudget(project, timestamp);
  const previous = validateBudgetAmount(existing.current);
  return {
    ...project,
    productionBudget: {
      ...existing,
      current: value,
      history: [
        ...existing.history,
        {
          previousBudget: previous,
          newBudget: value,
          timestamp,
          note: note.trim(),
          actor,
        },
      ],
    },
  };
}

function optionalNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeLedgerEntry(entry, defaults = {}) {
  const actualCost = optionalNumber(entry.actualCost ?? entry.amount, 0);
  const estimatedCost = optionalNumber(entry.estimatedCost, 0);
  return {
    id: entry.id || `ledger-${Date.now()}`,
    projectId: entry.projectId || defaults.projectId || PROJECT_ID,
    characterId: entry.characterId || null,
    sceneId: entry.sceneId || entry.scene || null,
    shotId: entry.shotId || entry.shot || null,
    generationId: entry.generationId || entry.takeId || null,
    provider: entry.provider || defaults.provider || "manual",
    model: entry.model || defaults.model || "uploaded-asset",
    routeId: entry.routeId || defaults.routeId || null,
    shotClass: entry.shotClass || defaults.shotClass || null,
    generationType: entry.generationType || defaults.generationType || GENERATION_TYPES.FINAL_IMAGE,
    estimatedCost: Math.round(estimatedCost * 10000) / 10000,
    actualCost: Math.round(actualCost * 10000) / 10000,
    generationStatus: GENERATION_STATUSES.includes(entry.generationStatus) ? entry.generationStatus : "completed",
    approvalStatus: APPROVAL_STATUSES.includes(entry.approvalStatus)
      ? entry.approvalStatus
      : entry.approved === false
        ? "rejected"
        : "approved",
    timestamp: entry.timestamp || entry.date || nowIso(),
    requestHash: entry.requestHash || null,
    requestSeconds: optionalNumber(entry.requestSeconds, 0),
    generatedSeconds: optionalNumber(entry.generatedSeconds, 0),
    usableSeconds: optionalNumber(entry.usableSeconds, 0),
    attemptNumber: Math.max(0, Math.round(optionalNumber(entry.attemptNumber, 0))),
    maxAttempts: Math.max(0, Math.round(optionalNumber(entry.maxAttempts, 0))),
    budgetCap: optionalNumber(entry.budgetCap, 0),
    salvageStatus: entry.salvageStatus || null,
    reusableAssetId: entry.reusableAssetId || null,
    currency: entry.currency || "USD",
    metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
    label: entry.label || "",
  };
}

export function normalizeLedger(ledger = []) {
  return ledger.map((entry) => normalizeLedgerEntry(entry));
}

export function ledgerActualCost(entry) {
  const normalized = normalizeLedgerEntry(entry);
  return normalized.actualCost;
}

export function calculateTotalSpent(ledger = []) {
  return ledger.reduce((total, entry) => total + ledgerActualCost(entry), 0);
}

export function calculateBudgetSummary(project, ledger = []) {
  const budget = normalizeBudget(project);
  const spent = calculateTotalSpent(ledger);
  const remaining = budget.current - spent;
  const percentageUsed = budget.current > 0 ? (spent / budget.current) * 100 : spent > 0 ? Infinity : 0;
  return {
    originalBudget: budget.original,
    currentBudget: budget.current,
    locked: budget.locked,
    lockedAt: budget.lockedAt,
    history: budget.history,
    spent,
    remaining,
    percentageUsed,
    warningState: budgetWarningState(percentageUsed),
  };
}

export function budgetWarningState(percentageUsed) {
  if (percentageUsed >= 100) return "over";
  if (percentageUsed >= 90) return "strong";
  if (percentageUsed >= 75) return "warning";
  return "normal";
}

export function summarizeLedgerForReporting(ledger = []) {
  const normalized = normalizeLedger(ledger);
  const empty = () => ({ spent: 0, entries: 0, generatedSeconds: 0, usableSeconds: 0 });
  return normalized.reduce(
    (summary, entry) => {
      const cost = ledgerActualCost(entry);
      for (const [bucket, key] of [
        ["byScene", entry.sceneId],
        ["byCharacter", entry.characterId],
        ["byProviderModel", `${entry.provider}/${entry.model}`],
        ["byRoute", entry.routeId],
        ["byApproval", entry.approvalStatus],
      ]) {
        const id = key || "none";
        summary[bucket][id] ||= empty();
        summary[bucket][id].spent += cost;
        summary[bucket][id].entries += 1;
        summary[bucket][id].generatedSeconds += entry.generatedSeconds;
        summary[bucket][id].usableSeconds += entry.usableSeconds;
      }
      summary.generatedSeconds += entry.generatedSeconds;
      summary.usableSeconds += entry.usableSeconds;
      return summary;
    },
    {
      byScene: {},
      byCharacter: {},
      byProviderModel: {},
      byRoute: {},
      byApproval: {},
      generatedSeconds: 0,
      usableSeconds: 0,
      projectedCompletionCost: null,
    }
  );
}
