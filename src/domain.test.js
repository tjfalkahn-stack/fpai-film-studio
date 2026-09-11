import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_REFERENCE_CATEGORIES,
  GENERATION_TYPES,
  adjustProductionBudget,
  budgetWarningState,
  calculateBudgetSummary,
  characterReferenceCount,
  isCharacterReferenceComplete,
  lockProductionBudget,
  mergeSavedCharacters,
  normalizeCharacter,
  normalizeLedgerEntry,
  setProductionBudget,
  summarizeLedgerForReporting,
} from "./domain.js";

const completeRefs = Object.fromEntries(
  CANONICAL_REFERENCE_CATEGORIES.map(({ key }) => [key, { key: `media:${key}`, name: `${key}.png` }])
);

test("character references persist as canonical metadata and count from stored asset keys", () => {
  const marcus = { id: "marcus", refs: { ...completeRefs, stray: { name: "not stored" } }, locked: false };
  assert.equal(characterReferenceCount(marcus), 5);
  assert.equal(isCharacterReferenceComplete(marcus), true);

  const jasmine = { id: "jasmine", refs: { identityFront: { key: "media:jasmine-front" } }, locked: false };
  assert.equal(characterReferenceCount(jasmine), 1);
  assert.equal(isCharacterReferenceComplete(jasmine), false);
});

test("seed character JSON cannot overwrite a saved canonical replacement", () => {
  const seed = {
    id: "jasmine",
    name: "Jasmine",
    refs: { identityFront: { key: "seed-jasmine", name: "old-seed.jpg" } },
  };
  const saved = {
    id: "jasmine",
    name: "Jasmine",
    refs: {
      identityFront: { key: "library:approved-jasmine", canonical: true, assetId: "approved-jasmine" },
    },
  };
  const [merged] = mergeSavedCharacters([saved], [seed]);
  assert.equal(merged.refs.identityFront.assetId, "approved-jasmine");
  assert.notEqual(merged.refs.identityFront.key, "seed-jasmine");
});

test("legacy masterFace references migrate to Identity / Front without completing lock alone", () => {
  const character = normalizeCharacter({
    id: "legacy",
    locked: true,
    refs: { masterFace: { key: "old-master-face", name: "front.png" } },
  });

  assert.equal(character.refs.identityFront.key, "old-master-face");
  assert.equal(characterReferenceCount(character), 1);
  assert.equal(character.locked, false);
});

test("complete canonical reference set is required before character lock is valid", () => {
  const incomplete = normalizeCharacter({ id: "turner", locked: true, refs: { ...completeRefs, wardrobe: null } });
  assert.equal(incomplete.locked, false);

  const complete = normalizeCharacter({ id: "mikey", locked: true, refs: completeRefs });
  assert.equal(complete.locked, true);
});

test("budget can be set, locked, and adjusted while preserving original budget", () => {
  let project = { productionBudget: { original: 1200, current: 1200, locked: false, lockedAt: null, history: [] } };
  project = setProductionBudget(project, 1200);
  project = lockProductionBudget(project, "2026-09-03T12:00:00.000Z");
  project = adjustProductionBudget(project, 1500, "Production scope increased", "owner-1", "2026-09-03T13:00:00.000Z");

  assert.equal(project.productionBudget.original, 1200);
  assert.equal(project.productionBudget.current, 1500);
  assert.equal(project.productionBudget.locked, true);
  assert.equal(project.productionBudget.history.length, 1);
  assert.deepEqual(project.productionBudget.history[0], {
    previousBudget: 1200,
    newBudget: 1500,
    timestamp: "2026-09-03T13:00:00.000Z",
    note: "Production scope increased",
    actor: "owner-1",
  });
});

test("generation ledger supports required schema fields and economy metadata", () => {
  const entry = normalizeLedgerEntry({
    projectId: "p1",
    characterId: "marcus",
    sceneId: "001",
    shotId: "027",
    generationId: "gen-1",
    provider: "google",
    model: "veo-3.1-fast-generate-preview",
    routeId: "veo-fast-720",
    shotClass: "hero",
    generationType: GENERATION_TYPES.VIDEO,
    estimatedCost: 0.8,
    actualCost: 0.8,
    generationStatus: "completed",
    approvalStatus: "approved",
    timestamp: "2026-09-03T14:00:00.000Z",
    requestHash: "fpai-123",
    requestSeconds: 8,
    generatedSeconds: 8,
    usableSeconds: 4.5,
    attemptNumber: 1,
    maxAttempts: 2,
    budgetCap: 3,
  });

  assert.equal(entry.projectId, "p1");
  assert.equal(entry.routeId, "veo-fast-720");
  assert.equal(entry.shotClass, "hero");
  assert.equal(entry.requestHash, "fpai-123");
  assert.equal(entry.generatedSeconds, 8);
  assert.equal(entry.usableSeconds, 4.5);
  assert.equal(entry.actualCost, 0.8);

  const summary = calculateBudgetSummary({ productionBudget: { original: 100, current: 100 } }, [entry]);
  assert.equal(summary.spent, 0.8);
  assert.equal(summary.remaining, 99.2);
  assert.equal(summary.percentageUsed, 0.8);
});

test("budget warning thresholds are normal, warning, strong warning, and over budget", () => {
  assert.equal(budgetWarningState(74.99), "normal");
  assert.equal(budgetWarningState(75), "warning");
  assert.equal(budgetWarningState(90), "strong");
  assert.equal(budgetWarningState(100), "over");
  assert.equal(budgetWarningState(125), "over");
});

test("ledger reporting buckets include route and usable footage totals", () => {
  const report = summarizeLedgerForReporting([
    { sceneId: "001", characterId: "marcus", provider: "google", model: "veo", routeId: "veo-fast-720", actualCost: 4, approvalStatus: "approved", generatedSeconds: 8, usableSeconds: 3 },
    { sceneId: "001", characterId: "jasmine", provider: "google", model: "veo", routeId: "veo-fast-720", actualCost: 6, approvalStatus: "rejected", generatedSeconds: 8, usableSeconds: 0 },
  ]);

  assert.equal(report.byScene["001"].spent, 10);
  assert.equal(report.byCharacter.marcus.entries, 1);
  assert.equal(report.byProviderModel["google/veo"].spent, 10);
  assert.equal(report.byRoute["veo-fast-720"].generatedSeconds, 16);
  assert.equal(report.byApproval.approved.spent, 4);
  assert.equal(report.usableSeconds, 3);
});
