import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleVideoAdapter } from "./googleAdapter.js";

const packet = {
  shot: { id: "027", scene: "001" },
  plan: {
    requestHash: "fpai-12345678",
    prompt: "Marcus steps from the vehicle in heavy rain.",
    route: { id: "veo-fast-720" },
    jobs: [{ jobIndex: 0, model: "veo-3.1-fast-generate-preview", resolution: "720p", durationSeconds: 8 }],
  },
  gate: { generateAllowed: true, executionBlockers: [] },
};

test("adapter submits only the minimal server-verifiable package", async () => {
  let captured;
  const adapter = createGoogleVideoAdapter({
    baseUrl: "https://adapter.example",
    token: "secret",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ job: { id: "job-1", status: "running" } }), { status: 202, headers: { "content-type": "application/json" } });
    },
  });
  const result = await adapter.submit({ packet, project: { id: "enemies-closer-ep01" }, ownerOverride: true });
  assert.equal(result.job.id, "job-1");
  assert.equal(captured.url, "https://adapter.example/api/generation-jobs");
  assert.equal(captured.init.headers.authorization, "Bearer secret");
  assert.equal(captured.init.headers["x-fpai-owner-override"], "confirm");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.plan.routeId, "veo-fast-720");
  assert.equal(body.plan.jobs[0].durationSeconds, 8);
});

test("adapter refuses live submission while the client execution gate is closed", () => {
  const adapter = createGoogleVideoAdapter({ fetchImpl: async () => { throw new Error("should not execute"); } });
  assert.throws(() => adapter.submit({ packet: { ...packet, gate: { generateAllowed: false, executionBlockers: ["Server adapter disconnected."] } }, project: { id: "p1" } }), /Server adapter disconnected/);
});
