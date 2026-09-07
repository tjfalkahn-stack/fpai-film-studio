import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRender } from "../src/renderClient.js";
import { approveTakeState, updateTakeState } from "../src/takeReview.js";
const plan = {
  route: { provider: "google", model: "other", id: "other-route" },
  oneAttemptCost: 1,
  requestSeconds: 8,
  shotClass: "hero",
  requestHash: "plan",
};
const render = {
  id: "test-render",
  projectId: "enemies-closer-ep01",
  sceneId: "001",
  shotId: "027",
  provider: "mock",
  model: "mock",
  status: "completed",
  estimatedCost: 0,
  actualCost: 0,
  duration: 8,
  resolution: "720p",
  createdAt: new Date().toISOString(),
  outputAsset: { url: "/api/renders/test-render/asset" },
};
const state = () =>
  mergeRender(
    {
      project: { id: render.projectId },
      shots: [{ id: "027", scene: "001", sec: 4.5, takes: [] }],
      ledger: [],
    },
    render,
  );
test("approve/reject and repeat approval preserve one render charge and survive refreshed server state", () => {
  let s = state();
  s = approveTakeState(s, "027", render.id, plan);
  assert.equal(s.shots[0].approved, true);
  assert.equal(s.ledger.length, 1);
  assert.equal(s.ledger[0].actualCost, 0);
  s = approveTakeState(s, "027", render.id, plan);
  assert.equal(s.ledger.length, 1);
  s = updateTakeState(s, "027", render.id, { status: "Rejected" });
  assert.equal(s.shots[0].approved, false);
  assert.equal(s.ledger[0].approvalStatus, "rejected");
  s = mergeRender(JSON.parse(JSON.stringify(s)), render);
  assert.equal(s.shots[0].takes[0].status, "Rejected");
  assert.equal(s.ledger[0].approvalStatus, "rejected");
  assert.equal(s.shots[0].takes.length, 1);
});
test("generated cost cannot be edited and rejecting paid footage still counts completed spend", () => {
  let s = mergeRender(
    {
      project: { id: render.projectId },
      shots: [{ id: "027", scene: "001", sec: 4.5, takes: [] }],
      ledger: [],
    },
    { ...render, provider: "veo-fast", actualCost: 0.8, estimatedCost: 0.8 },
  );
  s = updateTakeState(s, "027", render.id, {
    cost: 0,
    generatedSeconds: 2,
    status: "Rejected",
  });
  assert.equal(s.shots[0].takes[0].cost, 0.8);
  assert.equal(s.shots[0].takes[0].generatedSeconds, 8);
  assert.equal(s.ledger[0].actualCost, 0.8);
});
