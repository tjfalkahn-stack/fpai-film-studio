import { test } from "node:test";
import assert from "node:assert/strict";
import { createComfyCharacterExecutor } from "../worker/providers/comfyCharacter.js";
import { runComfyCharacterPreflight } from "../worker/providers/comfyPreflight.js";
import {
  CHARACTER_STILL_CHECKPOINT,
  CHARACTER_STILL_IPADAPTER,
  CHARACTER_STILL_STACK_ID,
} from "../src/characterStillStack.js";
import { createComfyFetchMock } from "./comfyFixtures.js";

const env = {
  COMFYUI_BASE_URL: "https://comfy.example/",
  COMFYUI_API_KEY: "test-key",
  LOCAL_DEV: "true",
};

test("preflight is ready when Comfy, checkpoint, identity models, nodes, and upload work", async () => {
  const { fetchImpl } = createComfyFetchMock();
  const result = await runComfyCharacterPreflight(env, fetchImpl);
  assert.equal(result.ready, true);
  assert.equal(result.stackId, CHARACTER_STILL_STACK_ID);
  assert.equal(result.liveGenerationEnabled, false);
  assert.equal(result.checks.every((item) => item.ok), true);
  assert.equal(result.missing.length, 0);
});

test("preflight reports a missing checkpoint with an actionable bootstrap step", async () => {
  const { fetchImpl } = createComfyFetchMock({ missingCheckpoint: true });
  const result = await runComfyCharacterPreflight(env, fetchImpl);
  assert.equal(result.ready, false);
  const checkpoint = result.checks.find((item) => item.id === "checkpoint");
  assert.equal(checkpoint.ok, false);
  assert.ok(result.missing.some((item) => item.name === CHARACTER_STILL_CHECKPOINT));
  assert.match(result.missing[0].action, /bootstrap\.sh/);
});

test("preflight reports missing IPAdapter custom nodes", async () => {
  const { fetchImpl } = createComfyFetchMock({
    missingNodes: ["IPAdapterUnifiedLoader", "IPAdapterEncoder", "IPAdapterEmbeds", "IPAdapterCombineEmbeds", "PrepImageForClipVision"],
  });
  const result = await runComfyCharacterPreflight(env, fetchImpl);
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((item) => item.id === "custom_nodes").ok, false);
  assert.ok(result.missing.some((item) => item.component === "custom_node" || item.component === "node_class"));
});

test("preflight reports missing identity adapter weights", async () => {
  const { fetchImpl, calls } = createComfyFetchMock();
  const wrapped = async (url, init) => {
    if (String(url).includes("/models/ipadapter")) return Response.json(["unrelated.safetensors"]);
    if (String(url).includes("/object_info/IPAdapterModelLoader")) {
      return Response.json({
        IPAdapterModelLoader: { input: { required: { ipadapter_file: [["unrelated.safetensors"]] } } },
      });
    }
    return fetchImpl(url, init);
  };
  const result = await runComfyCharacterPreflight(env, wrapped);
  assert.equal(result.ready, false);
  assert.ok(result.missing.some((item) => item.name === CHARACTER_STILL_IPADAPTER));
  assert.ok(calls.length > 0);
});

test("preflight reports reference upload failure", async () => {
  const { fetchImpl } = createComfyFetchMock({ failUpload: true });
  const result = await runComfyCharacterPreflight(env, fetchImpl);
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((item) => item.id === "reference_upload").ok, false);
});

test("preflight does not require live generation flags", async () => {
  const { fetchImpl } = createComfyFetchMock();
  const result = await runComfyCharacterPreflight(
    { ...env, CHARACTER_FACTORY_LIVE_ENABLED: "false", LIVE_RENDERING_ENABLED: "false" },
    fetchImpl,
  );
  assert.equal(result.ready, true);
  assert.equal(result.liveGenerationEnabled, false);
});

test("character executor preflight method uses the same health check", async () => {
  const { fetchImpl } = createComfyFetchMock();
  const executor = createComfyCharacterExecutor(env, fetchImpl);
  const result = await executor.preflight();
  assert.equal(result.ready, true);
});
