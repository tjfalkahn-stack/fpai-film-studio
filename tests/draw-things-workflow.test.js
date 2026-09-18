import { test } from "node:test";
import assert from "node:assert/strict";
import { createDrawThingsLocalProvider } from "../worker/providers/drawThings.js";
import {
  buildDrawThingsHandoff,
  buildDrawThingsNegativePrompt,
  buildDrawThingsPrompt,
  drawThingsHandoffFilename,
} from "../src/drawThingsWorkflow.js";

const context = {
  project: { id: "enemies-closer-ep01", title: "ENEMIES CLOSER" },
  scene: { id: "003", title: "Warehouse / Night" },
  shot: {
    id: "012",
    scene: "003",
    sec: 3,
    subject: "Turner wounded during the raid",
    move: "Handheld medium close-up",
  },
  plan: { prompt: "Adult Detective Turner is struck during a fictional action-film shootout." },
  characters: [
    {
      id: "turner",
      name: "Detective Turner",
      wardrobe: "SWAT tactical wardrobe",
      notes: "Adult detective with locked facial identity.",
    },
  ],
  resolution: "1024x576",
  aspectRatio: "16:9",
};

test("Draw Things is a zero-charge local provider and cannot execute server-side", () => {
  const provider = createDrawThingsLocalProvider();
  assert.equal(provider.capabilities.id, "draw-things-local");
  assert.equal(provider.capabilities.manual, true);
  assert.equal(provider.capabilities.local, true);
  assert.equal(provider.capabilities.paid, false);
  assert.equal(provider.capabilities.outputType, "image");
  assert.equal(provider.capabilities.maxReferences, 3);
  assert.equal(provider.estimate({}).estimatedCost, 0);
  assert.throws(() => provider.start({}), /runs locally/);
  assert.throws(() => provider.status({}), /runs locally/);
});

test("Draw Things handoff preserves the adult action shot, references, and local-only settings", () => {
  const handoff = buildDrawThingsHandoff({
    ...context,
    referenceSelection: {
      selected: [
        {
          assetId: "8f78397b-5b28-4d30-a75c-afb2d59ff9e4",
          characterId: "turner",
          order: 1,
          reasons: ["primary-identity", "shot-cast"],
        },
        {
          assetId: "9f78397b-5b28-4d30-a75c-afb2d59ff9e4",
          characterId: "turner",
          order: 2,
          reasons: ["wardrobe-match"],
        },
      ],
    },
    generatedAt: "2026-09-18T00:00:00.000Z",
  });
  assert.equal(handoff.provider, "draw-things-local");
  assert.equal(handoff.localApplication, "Draw Things");
  assert.equal(handoff.requestedOutput.mediaType, "image");
  assert.equal(handoff.requestedOutput.resolution, "1024x576");
  assert.equal(handoff.references.length, 2);
  assert.match(handoff.references[0].instruction, /primary image-to-image/);
  assert.match(handoff.references[1].instruction, /wardrobe/);
  assert.match(handoff.prompt, /Adult Detective Turner/);
  assert.match(handoff.prompt, /fictional/);
  assert.match(handoff.negativePrompt, /changed identity/);
  assert.equal(handoff.recommendedSettings.cloudCompute, false);
  assert.match(handoff.returnStep, /Upload completed take/);
});

test("Draw Things prompts and filename remain deterministic", () => {
  assert.equal(buildDrawThingsPrompt(context), buildDrawThingsPrompt(context));
  assert.equal(buildDrawThingsNegativePrompt(), buildDrawThingsNegativePrompt());
  assert.equal(
    drawThingsHandoffFilename("enemies closer / ep01", "012"),
    "enemies-closer-ep01-shot-012-draw-things-handoff.json",
  );
});
