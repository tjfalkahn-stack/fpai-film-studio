import test from "node:test";
import assert from "node:assert/strict";
import {
  createBenchmarkReport,
  createCharacterFactoryPlan,
  createCharacterFactorySmokePlan,
  normalizeCharacterProfile,
  scoreCharacterResult,
} from "./characterFactory.js";
import {
  CHARACTER_REALISM_LOCK_ID,
  CHARACTER_REALISM_NEGATIVE_PROMPT,
  applyCharacterRealismPrompt,
  isCharacterRealismLockedMedium,
  mergeCharacterNegativePrompts,
} from "./characterRealismLock.js";

test("normalizes Marcus into a stable character profile", () => {
  const profile = normalizeCharacterProfile({
    id: "marcus",
    name: 'Marcus "Kingpin" Holloway',
    role: "Kingpin / protagonist",
    height: "6'2\"",
    build: "lean athletic",
    wardrobe: ["Tarmac Look 01", "all-black tactical masked"],
  });
  assert.equal(profile.id, "marcus");
  assert.equal(profile.height, "6'2\"");
  assert.deepEqual(profile.wardrobe, ["Tarmac Look 01", "all-black tactical masked"]);
});

test("builds the complete Marcus Character Factory benchmark matrix", () => {
  const plan = createCharacterFactoryPlan({
    medium: "cinematic",
    character: {
      id: "marcus",
      name: 'Marcus "Kingpin" Holloway',
      role: "Kingpin / protagonist",
      height: "6'2\"",
      build: "lean athletic",
      skinTone: "deep brown",
      wardrobe: ["Tarmac Look 01", "all-black tactical masked"],
      protectedTraits: ["tall 6'2 apparent height", "lean athletic proportions"],
      negativeTraits: ["short or squat proportions"],
    },
  });

  assert.equal(plan.schema, "fpai.character-factory.plan.v1");
  assert.equal(plan.version, "2.0.0");
  assert.equal(plan.medium, "cinematic");
  assert.equal(plan.realismLock.id, CHARACTER_REALISM_LOCK_ID);
  assert.equal(plan.realismLock.benchmark, "Jasmine");
  assert.equal(plan.realismLock.applied, true);
  assert.equal(plan.negativePrompt.startsWith(CHARACTER_REALISM_NEGATIVE_PROMPT), true);
  assert.equal(plan.totals.angles, 8);
  assert.equal(plan.totals.expressions, 7);
  assert.equal(plan.totals.wardrobe, 2);
  assert.equal(plan.totals.continuity, 4);
  assert.equal(plan.totals.jobs, 21);
  assert.match(plan.jobs[0].prompt, /6'2/);
  assert.doesNotMatch(plan.jobs[0].prompt, /short or squat proportions/);
  assert.match(plan.negativePrompt, /short or squat proportions/);
  assert.match(plan.jobs[0].prompt, /real human being, captured in camera/i);
  assert.match(plan.jobs[0].prompt, /primary identity anchor as the sole authority/i);
  assert.match(plan.jobs[0].prompt, /standalone native-resolution image/i);
  assert.match(plan.negativePrompt, /video game/i);
});

test("character result score requires both overall quality and identity fidelity", () => {
  const pass = scoreCharacterResult({ identity: 0.94, photographicRealism: 0.95, anatomy: 0.9, framing: 0.9, wardrobe: 0.9, artifactFree: 0.92 });
  assert.equal(pass.pass, true);

  const identityFail = scoreCharacterResult({ identity: 0.7, photographicRealism: 1, anatomy: 1, framing: 1, wardrobe: 1, artifactFree: 1 });
  assert.equal(identityFail.pass, false);

  const syntheticFail = scoreCharacterResult({ identity: 1, photographicRealism: 0.45, anatomy: 1, framing: 1, wardrobe: 1, artifactFree: 1 });
  assert.equal(syntheticFail.pass, false);
});

test("realism exclusions cannot be replaced by a shorter custom negative prompt", () => {
  const merged = mergeCharacterNegativePrompts(CHARACTER_REALISM_NEGATIVE_PROMPT, "watermark, fog");
  assert.match(merged, /video game/i);
  assert.match(merged, /fog/i);
  assert.equal(merged.match(/watermark/gi)?.length, 1);
});

test("realism prompt contract is restored if a locked job prompt is shortened", () => {
  const locked = applyCharacterRealismPrompt("FRAME: straight-on portrait.");
  assert.match(locked, /real human being, captured in camera/i);
  assert.match(locked, /primary identity anchor as the sole authority/i);
  assert.match(locked, /FRAME: straight-on portrait/);
  assert.equal(applyCharacterRealismPrompt(locked), locked);
});

test("realism lock covers every live-action medium and leaves explicit art styles alone", () => {
  assert.equal(isCharacterRealismLockedMedium("cinematic"), true);
  assert.equal(isCharacterRealismLockedMedium("vintage"), true);
  assert.equal(isCharacterRealismLockedMedium("animation"), false);

  const vintage = createCharacterFactoryPlan({ character: { name: "Period Lead" }, medium: "vintage" });
  assert.equal(vintage.realismLock.applied, true);
  assert.match(vintage.jobs[0].prompt, /real human being, captured in camera/i);
  assert.match(vintage.jobs[0].prompt, /period-authentic image treatment/i);

  const animation = createCharacterFactoryPlan({ character: { name: "Animated Lead" }, medium: "animation" });
  assert.equal(animation.realismLock.applied, false);
  assert.equal(animation.negativePrompt, undefined);
});

test("smoke plan is a single identity-front job for the first controlled test", () => {
  const plan = createCharacterFactorySmokePlan({
    character: { id: "jasmine", name: "Jasmine", wardrobe: ["Tarmac Look 01"] },
    referenceImages: [{ mimeType: "image/png", data: "aaa", category: "identity_anchor" }],
  });
  assert.equal(plan.smokeTest, true);
  assert.equal(plan.totals.jobs, 1);
  assert.equal(plan.jobs[0].taskId, "identity-front");
  assert.equal(plan.referenceImages.length, 1);
  assert.equal(plan.jobs[0].referenceImages.length, 1);
});

test("benchmark report measures retries, cost, compute, and readiness", () => {
  const plan = createCharacterFactoryPlan({
    medium: "cinematic",
    expressions: ["neutral"],
    wardrobe: ["default"],
    character: { id: "marcus", name: "Marcus", wardrobe: ["default"] },
  });

  const attempts = plan.jobs.flatMap((job, index) => {
    const score = scoreCharacterResult({ identity: 0.95, photographicRealism: 0.95, anatomy: 0.92, framing: 0.95, wardrobe: 0.9, artifactFree: 0.95 });
    if (index === 0) {
      return [
        { jobId: job.id, score: scoreCharacterResult({ identity: 0.6, photographicRealism: 0.9, anatomy: 0.7, framing: 0.9, wardrobe: 0.9, artifactFree: 0.9 }), computeSeconds: 5, costUsd: 0.01 },
        { jobId: job.id, score, accepted: true, computeSeconds: 5, costUsd: 0.01, asset: "accepted/identity-front.png" },
      ];
    }
    return [{ jobId: job.id, score, accepted: true, computeSeconds: 5, costUsd: 0.01, asset: `${job.id}.png` }];
  });

  const report = createBenchmarkReport(plan, attempts);
  assert.equal(report.acceptanceRate, 1);
  assert.equal(report.rejectCount, 1);
  assert.ok(report.computeSeconds > 0);
  assert.ok(report.costUsd > 0);
  assert.equal(report.ready, true);
});
