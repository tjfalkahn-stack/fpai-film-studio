import test from "node:test";
import assert from "node:assert/strict";
import {
  createBenchmarkReport,
  createCharacterFactoryPlan,
  createCharacterFactorySmokePlan,
  normalizeCharacterProfile,
  scoreCharacterResult,
} from "./characterFactory.js";

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
  assert.equal(plan.medium, "cinematic");
  assert.equal(plan.totals.angles, 8);
  assert.equal(plan.totals.expressions, 7);
  assert.equal(plan.totals.wardrobe, 2);
  assert.equal(plan.totals.continuity, 4);
  assert.equal(plan.totals.jobs, 21);
  assert.match(plan.jobs[0].prompt, /6'2/);
  assert.match(plan.jobs[0].prompt, /short or squat proportions/);
});

test("character result score requires both overall quality and identity fidelity", () => {
  const pass = scoreCharacterResult({ identity: 0.94, anatomy: 0.9, framing: 0.9, wardrobe: 0.9, artifactFree: 0.92 });
  assert.equal(pass.pass, true);

  const identityFail = scoreCharacterResult({ identity: 0.7, anatomy: 1, framing: 1, wardrobe: 1, artifactFree: 1 });
  assert.equal(identityFail.pass, false);
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
    const score = scoreCharacterResult({ identity: 0.95, anatomy: 0.92, framing: 0.95, wardrobe: 0.9, artifactFree: 0.95 });
    if (index === 0) {
      return [
        { jobId: job.id, score: scoreCharacterResult({ identity: 0.6, anatomy: 0.7, framing: 0.9, wardrobe: 0.9, artifactFree: 0.9 }), computeSeconds: 5, costUsd: 0.01 },
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
