import { test } from "node:test";
import assert from "node:assert/strict";
import { createVibesManualProvider } from "../worker/providers/vibes.js";
import {
  buildVibesHandoff,
  buildVibesPrompt,
  vibesHandoffFilename,
} from "../src/vibesWorkflow.js";

const context = {
  project: { id: "enemies-closer-ep01", title: "ENEMIES CLOSER" },
  scene: { id: "001", title: "Tarmac / Night / Rain" },
  shot: {
    id: "027",
    scene: "001",
    sec: 4.5,
    subject: "Marcus hero reveal",
    move: "Stabilized push-in",
  },
  plan: { prompt: "Marcus takes control of the rain-soaked tarmac." },
  characters: [
    {
      id: "marcus",
      name: 'Marcus "Kingpin" Holloway',
      wardrobe: "Tarmac Look 01",
      notes: "Tall 6'2 apparent height and lean athletic proportions.",
    },
  ],
  duration: 8,
  resolution: "720p",
  aspectRatio: "16:9",
};

test("Vibes is cataloged as a zero-FPAI-charge manual provider and cannot execute server-side", async () => {
  const provider = createVibesManualProvider();
  assert.equal(provider.capabilities.id, "vibes-manual");
  assert.equal(provider.capabilities.manual, true);
  assert.equal(provider.capabilities.paid, false);
  assert.equal(provider.capabilities.externalUrl, "https://vibes.ai/");
  assert.equal(provider.capabilities.maxReferences, 1);
  assert.equal(provider.estimate({}).estimatedCost, 0);
  assert.throws(() => provider.start({}), /manual browser handoff/);
  assert.throws(() => provider.status({}), /manual browser handoff/);
});

test("Vibes handoff preserves shot, cast, identity constraints, and selected reference manifest", () => {
  const referenceSelection = {
    selected: [
      {
        assetId: "8f78397b-5b28-4d30-a75c-afb2d59ff9e4",
        characterId: "marcus",
        order: 1,
        reasons: ["primary-identity", "shot-cast"],
      },
    ],
  };
  const handoff = buildVibesHandoff({
    ...context,
    referenceSelection,
    generatedAt: "2026-09-17T20:00:00.000Z",
  });
  assert.equal(handoff.provider, "vibes-manual");
  assert.equal(handoff.destination, "https://vibes.ai/");
  assert.equal(handoff.shot.id, "027");
  assert.equal(handoff.requestedOutput.duration, 8);
  assert.equal(handoff.references[0].characterId, "marcus");
  assert.match(handoff.references[0].instruction, /Primary Identity/);
  assert.match(handoff.prompt, /Marcus hero reveal/);
  assert.match(handoff.prompt, /Stabilized push-in/);
  assert.match(handoff.prompt, /Preserve the uploaded reference identity/);
  assert.match(handoff.returnStep, /Upload completed take/);
});

test("Vibes prompt and filename remain deterministic for the same shot", () => {
  assert.equal(buildVibesPrompt(context), buildVibesPrompt(context));
  assert.equal(
    vibesHandoffFilename("enemies closer / ep01", "027"),
    "enemies-closer-ep01-shot-027-vibes-handoff.json",
  );
});
