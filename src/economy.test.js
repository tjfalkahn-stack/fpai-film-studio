import test from "node:test";
import assert from "node:assert/strict";
import {
  ROUTE_BY_ID,
  attemptsUsedForShot,
  buildGenerationPlan,
  calculateProductionEconomy,
  classifyShot,
  createQueuedLedgerEntry,
  createSalvageRecord,
  defaultRouteIdForShot,
  estimateRouteCost,
  evaluateBudgetGate,
  fullRuntimeForecast,
  normalizeUsableRanges,
  parseUsableRangeText,
  planClipDurations,
  providerPerformance,
  selectEconomicalRoute,
  stableHash,
  usableSecondsFromRanges,
} from "./economy.js";

const project = {
  id: "p1",
  runtime: 1620,
  drift: "STRICT",
  economy: {
    generationTarget: 125,
    workingCeiling: 200,
    emergencyCeiling: 250,
    requireAnimaticLock: true,
  },
};

const genericShot = {
  id: "003",
  scene: "001",
  sec: 3,
  mode: "CHAOS",
  subject: "Rain on an empty runway",
  move: "Slow drift",
  characters: [],
  economy: { animaticApproved: true, motionNeed: "generative", maxAttempts: 2, shotCap: 1 },
};

test("clip planner respects flexible Omni output and fixed eight-second Veo output", () => {
  assert.deepEqual(planClipDurations(0), []);
  assert.deepEqual(planClipDurations(2, "omni-flash-720"), [3]);
  assert.deepEqual(planClipDurations(4.5, "omni-flash-720"), [5]);
  assert.deepEqual(planClipDurations(8, "omni-flash-720"), [8]);
  assert.deepEqual(planClipDurations(11, "omni-flash-720"), [8, 3]);
  assert.deepEqual(planClipDurations(17, "omni-flash-720"), [10, 7]);
  assert.deepEqual(planClipDurations(2, "veo-lite-720"), [8]);
  assert.deepEqual(planClipDurations(9, "veo-lite-720"), [8, 8]);
});

test("shot classifier sends local, identity, action, and hero work to distinct classes", () => {
  assert.equal(classifyShot({ ...genericShot, subject: "BLACK / child crying", economy: { motionNeed: "local" } }, project), "local-render");
  assert.equal(classifyShot({ ...genericShot, characters: ["marcus"], subject: "Marcus watches the runway" }, project), "identity-motion");
  assert.equal(classifyShot({ ...genericShot, subject: "Convoy pursuit and crash" }, project), "vehicle-motion");
  assert.equal(classifyShot({ ...genericShot, status: "Hero", characters: ["marcus"] }, project), "hero");
});

test("default routing uses local work locally, Omni for short shots, and Lite when fixed Veo becomes cheaper", () => {
  assert.equal(defaultRouteIdForShot({ ...genericShot, economy: { motionNeed: "local" } }, project), "local-composite");
  assert.equal(defaultRouteIdForShot(genericShot, project), "omni-flash-720");
  assert.equal(defaultRouteIdForShot({ ...genericShot, sec: 8 }, project), "veo-lite-720");
  assert.equal(defaultRouteIdForShot({ ...genericShot, characters: ["marcus"] }, project), "omni-flash-720");
  assert.equal(defaultRouteIdForShot({ ...genericShot, characters: ["marcus"], economy: { ...genericShot.economy, nativeDetail: true } }, project), "veo-fast-1080");
});

test("cost estimate never understates fixed Veo output and prices flexible Omni separately", () => {
  const veo = estimateRouteCost(ROUTE_BY_ID["veo-lite-720"], genericShot, [], project);
  assert.equal(veo.requestSeconds, 8);
  assert.equal(veo.oneAttemptCost, 0.4);
  assert.equal(veo.expectedAttempts, 1.45);
  assert.equal(veo.expectedCost, 0.58);
  assert.equal(veo.maxExposure, 0.8);

  const omni = estimateRouteCost(ROUTE_BY_ID["omni-flash-720"], genericShot, [], project);
  assert.equal(omni.requestSeconds, 3);
  assert.equal(omni.oneAttemptCost, 0.3);
  assert.equal(omni.expectedAttempts, 1.25);
  assert.equal(omni.expectedCost, 0.375);
  assert.equal(omni.maxExposure, 0.6);
});


test("router learns from actual usable-second economics after enough reviewed requests", () => {
  const ledger = [
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `omni-${index}`,
      routeId: "omni-flash-720",
      provider: "google",
      model: "gemini-omni-1.1-flash",
      generationStatus: "completed",
      approvalStatus: "approved",
      actualCost: 0.3,
      generatedSeconds: 3,
      usableSeconds: 1,
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `lite-${index}`,
      routeId: "veo-lite-720",
      provider: "google",
      model: "veo-3.1-lite-generate-preview",
      generationStatus: "completed",
      approvalStatus: "approved",
      actualCost: 0.4,
      generatedSeconds: 8,
      usableSeconds: 3,
    })),
  ];
  const selected = selectEconomicalRoute(genericShot, ledger, project);
  assert.equal(selected.route.id, "veo-lite-720");
  assert.equal(selected.scoreSource, "learned");
});

test("generation plans are deterministic and change when the prompt changes", () => {
  const one = buildGenerationPlan({ shot: genericShot, project });
  const two = buildGenerationPlan({ shot: { ...genericShot }, project });
  const three = buildGenerationPlan({ shot: { ...genericShot, prompt: "Add lightning" }, project });
  assert.equal(one.requestHash, two.requestHash);
  assert.notEqual(one.requestHash, three.requestHash);
  assert.equal(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }));
});

test("budget gate blocks paid work until animatic and continuity are cleared", () => {
  const shot = { ...genericShot, economy: { ...genericShot.economy, animaticApproved: false } };
  const plan = buildGenerationPlan({ shot, project });
  const gate = evaluateBudgetGate({ project, scene: { animaticLocked: false }, shot, plan, continuityReady: false });
  assert.equal(gate.queueAllowed, false);
  assert.ok(gate.blockers.some((value) => value.includes("animatic")));
  assert.ok(gate.blockers.some((value) => value.includes("Continuity")));
});

test("budget gate allows a dry-run queue but not provider execution without server controls", () => {
  const plan = buildGenerationPlan({ shot: genericShot, project });
  const gate = evaluateBudgetGate({
    project,
    scene: { animaticLocked: true },
    shot: genericShot,
    plan,
    continuityReady: true,
  });
  assert.equal(gate.queueAllowed, true);
  assert.equal(gate.generateAllowed, false);
  assert.equal(gate.executionBlockers.length, 2);
});

test("duplicate hashes and attempt limits prevent accidental repeat charges", () => {
  const plan = buildGenerationPlan({ shot: genericShot, project });
  const queued = createQueuedLedgerEntry({ plan, project, shot: genericShot, timestamp: "2026-09-03T00:00:00Z" });
  const gate = evaluateBudgetGate({
    project,
    scene: { animaticLocked: true },
    shot: genericShot,
    plan,
    ledger: [queued],
    continuityReady: true,
  });
  assert.equal(gate.queueAllowed, false);
  assert.ok(gate.blockers.some((value) => value.includes("Duplicate")));
  assert.equal(attemptsUsedForShot([queued], genericShot.id), 1);
});

test("shot caps and standard-tier owner controls are enforced", () => {
  const cappedShot = { ...genericShot, economy: { ...genericShot.economy, shotCap: 0.1 } };
  const cappedPlan = buildGenerationPlan({ shot: cappedShot, project });
  const cappedGate = evaluateBudgetGate({ project, scene: { animaticLocked: true }, shot: cappedShot, plan: cappedPlan, continuityReady: true });
  assert.ok(cappedGate.blockers.some((value) => value.includes("shot cap")));

  const standardShot = { ...genericShot, economy: { ...genericShot.economy, manualRouteId: "veo-standard-720", shotCap: 5 } };
  const standardPlan = buildGenerationPlan({ shot: standardShot, project });
  const standardGate = evaluateBudgetGate({ project, scene: { animaticLocked: true }, shot: standardShot, plan: standardPlan, continuityReady: true });
  assert.ok(standardGate.blockers.some((value) => value.includes("Standard")));
});

test("provider performance learns actual cost per usable second", () => {
  const performance = providerPerformance([
    { routeId: "veo-lite-720", generationStatus: "completed", approvalStatus: "approved", actualCost: 0.2, generatedSeconds: 4, usableSeconds: 3 },
    { routeId: "veo-lite-720", generationStatus: "completed", approvalStatus: "rejected", actualCost: 0.2, generatedSeconds: 4, usableSeconds: 0 },
  ]);
  assert.equal(performance["veo-lite-720"].requests, 2);
  assert.equal(performance["veo-lite-720"].acceptanceRate, 0.5);
  assert.equal(performance["veo-lite-720"].costPerUsableSecond, 0.4 / 3);
});


test("salvage range text parses, clamps, and merges editor timecodes", () => {
  assert.deepEqual(
    parseUsableRangeText("0-2.4, 2-3; 7.5 to 9, invalid", 8),
    [{ start: 0, end: 3 }, { start: 7.5, end: 8 }],
  );
});

test("salvage ranges merge overlap and preserve only usable paid seconds", () => {
  const ranges = normalizeUsableRanges([{ start: 0, end: 2 }, { start: 1.5, end: 3 }, { start: 7, end: 9 }], 8);
  assert.deepEqual(ranges, [{ start: 0, end: 3 }, { start: 7, end: 8 }]);
  assert.equal(usableSecondsFromRanges(ranges, 8), 4);
  const record = createSalvageRecord({ takeId: "take-1", ranges, sourceDuration: 8, uses: ["reaction"] });
  assert.equal(record.usableSeconds, 4);
  assert.equal(record.status, "salvaged");
});

test("manual salvage measurements are preserved when exact ranges are unavailable", () => {
  const record = createSalvageRecord({ takeId: "take-manual", sourceDuration: 8, usableSeconds: 2.75 });
  assert.equal(record.usableSeconds, 2.75);
  assert.equal(record.status, "salvaged");
  assert.deepEqual(record.ranges, []);
});

test("27-minute forecast lands near the economy target and beats naive generation", () => {
  const forecast = fullRuntimeForecast(project);
  assert.equal(forecast.naiveCost, 518.4);
  assert.ok(forecast.forecast > 120 && forecast.forecast < 130);
  assert.ok(forecast.savingsPercent > 70);

  const summary = calculateProductionEconomy({ project, shots: [genericShot], ledger: [] });
  assert.equal(summary.paidShotCount, 1);
  assert.equal(summary.mappedExpectedCost, 0.375);
});
