import test from "node:test";
import assert from "node:assert/strict";
import { withCharacterContinuity } from "./characterContinuity.js";

test("applies approved film character rules to the shot prompt", () => {
  const prompt = withCharacterContinuity("Marcus steps into view.", {
    projectId: "enemies-closer-ep01",
    sceneId: "001",
    shotId: "027",
    characters: [{ id: "marcus", name: "Marcus", wardrobe: "Regular Look 03" }],
  });
  assert.match(prompt, /same approved clean identity master for each shot/);
  assert.match(prompt, /SELECTED LOOK: Regular Look 03/);
  assert.match(prompt, /subtle irregular pores/);
  assert.match(prompt, /SHOT 027: Marcus hero reveal/);
  assert.match(prompt, /SHOT PROMPT: Marcus steps into view/);
});

test("preserves scene-specific locks and Turner wound location", () => {
  const prompt = withCharacterContinuity("Find Turner.", {
    projectId: "enemies-closer-ep01",
    sceneId: "001",
    shotId: "012",
    characters: [{ id: "turner", name: "Turner", wardrobe: "SWAT Look 01" }],
  });
  assert.match(prompt, /thigh and lower-abdomen wounds/);
  assert.match(prompt, /without goggles/);
  assert.match(prompt, /SELECTED LOOK: SWAT Look 01/);
});

test("does not apply Enemies Closer rules to The Yard", () => {
  assert.equal(withCharacterContinuity("PV spokesperson.", {
    projectId: "the-yard-is-home",
    sceneId: "001",
    shotId: "PV",
    characters: [{ id: "jasmine" }],
  }), "PV spokesperson.");
});
