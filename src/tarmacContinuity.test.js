import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTarmacCharacterLocks,
  TARMAC_CHARACTER_LOCKS,
  withTarmacCharacterLocks,
} from "./tarmacContinuity.js";

test("Scene 001 airport locks replace stale Jasmine and Mikey wardrobe metadata", () => {
  const locked = applyTarmacCharacterLocks([
    { id: "jasmine", wardrobe: "leather jacket" },
    { id: "mikey", wardrobe: "Pajamas 01", voice: "Natural four-year-old" },
  ]);
  assert.match(locked[0].wardrobe, /matte-black zip-front bomber jacket/);
  assert.match(locked[0].wardrobe, /black cargo pants/);
  assert.match(locked[1].wardrobe, /black Nike pullover hoodie/);
  assert.match(locked[1].wardrobe, /checkerboard weave/);
  assert.equal(locked[1].voice, "Natural six-year-old");
});

test("Scene 001 generation prompts always contain exact likeness and wardrobe locks", () => {
  const prompt = withTarmacCharacterLocks("Mikey sees Marcus.", {
    sceneId: "001",
    characterIds: ["jasmine", "mikey"],
  });
  assert.match(prompt, /JASMINE EXACT LIKENESS LOCK/);
  assert.match(prompt, /MIKEY EXACT LIKENESS LOCK/);
  assert.match(prompt, /exactly six-year-old light-complexioned, fair-skinned Black boy/i);
  assert.doesNotMatch(prompt, /medium-brown/i);
  assert.match(prompt, /light-complexioned, fair-skinned Black/i);
  assert.match(prompt, /small white Nike wordmark and Swoosh/);
  assert.match(prompt, /SHOT PROMPT: Mikey sees Marcus\./);
  assert.equal(
    withTarmacCharacterLocks("Different scene", {
      sceneId: "002",
      characterIds: ["mikey"],
    }),
    "Different scene",
  );
  assert.match(TARMAC_CHARACTER_LOCKS.jasmine.appearanceLock, /very long dense black wavy-curly hair/);
});
