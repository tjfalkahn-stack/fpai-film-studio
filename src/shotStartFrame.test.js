import { test } from "node:test";
import assert from "node:assert/strict";
import {
  START_FRAME_SOURCE_LIMIT,
  isLtxProviderId,
  renderReferenceKeys,
  validateShotStartFrame,
} from "./shotStartFrame.js";

test("Shot Start Frame accepts stored PNG and JPEG production stills", () => {
  assert.deepEqual(
    validateShotStartFrame({ name: "027.png", type: "image/png", size: 2_388_943 }),
    { name: "027.png", mimeType: "image/png", size: 2_388_943 },
  );
  assert.throws(
    () => validateShotStartFrame({ name: "027.webp", type: "image/webp", size: 100 }),
    /PNG or JPEG/,
  );
  assert.throws(
    () => validateShotStartFrame({ name: "027.png", type: "image/png", size: START_FRAME_SOURCE_LIMIT + 1 }),
    /20 MB/,
  );
});

test("LTX always receives the composed Shot Start Frame instead of a portrait reference", () => {
  assert.equal(isLtxProviderId("ltx-2.5-fast"), true);
  assert.deepEqual(
    renderReferenceKeys({
      provider: "ltx-2.5-fast",
      startFrameKey: "shot:027:start-frame:1",
      selected: ["char:marcus:identity"],
    }),
    ["shot:027:start-frame:1"],
  );
  assert.deepEqual(
    renderReferenceKeys({
      provider: "seedance-fast",
      startFrameKey: "shot:027:start-frame:1",
      selected: ["char:marcus:identity"],
    }),
    ["char:marcus:identity"],
  );
});

test("Yard Google trial selects its composed start frame instead of a character portrait", () => {
  assert.deepEqual(renderReferenceKeys({
    provider: "veo-fast",
    startFrameKey: "shot:SOUTHERN:start-frame:1",
    selected: ["char:friend:identity"],
    forceStartFrame: true,
  }), ["shot:SOUTHERN:start-frame:1"]);
});
