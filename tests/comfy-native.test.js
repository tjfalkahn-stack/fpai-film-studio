import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectHistoryOutputs,
  encodeComfyAsset,
  interpretHistory,
  loadImageName,
  resolveComfyUrl,
} from "../worker/providers/comfyNative.js";

test("native Comfy helper encodes view assets and load-image names", () => {
  const asset = encodeComfyAsset({
    filename: "marcus.png",
    subfolder: "identity",
    type: "output",
    contentType: "image/png",
  });
  assert.equal(asset.contentType, "image/png");
  assert.equal(new URLSearchParams(asset.id).get("filename"), "marcus.png");
  assert.equal(new URLSearchParams(asset.id).get("subfolder"), "identity");
  assert.equal(loadImageName({ name: "ref.png", subfolder: "fpai" }), "fpai/ref.png");
  assert.equal(loadImageName({ name: "ref.png", subfolder: "" }), "ref.png");
});

test("native Comfy helper resolves paths under a base prefix", () => {
  const url = resolveComfyUrl("https://pod.example/comfy/", "/prompt");
  assert.equal(String(url), "https://pod.example/comfy/prompt");
  const view = resolveComfyUrl("https://pod.example/", "/view?filename=a.png&type=output");
  assert.equal(view.pathname, "/view");
  assert.equal(view.searchParams.get("filename"), "a.png");
});

test("native history interpretation maps running, failed, and image outputs", () => {
  assert.equal(interpretHistory("p1", {}, { kind: "image" }).status, "running");
  assert.equal(
    interpretHistory(
      "p1",
      { p1: { status: { status_str: "success", completed: false }, outputs: {} } },
      { kind: "image" },
    ).status,
    "running",
  );
  const failed = interpretHistory(
    "p1",
    {
      p1: {
        status: {
          status_str: "error",
          completed: true,
          messages: [["execution_error", { exception_message: "CUDA OOM" }]],
        },
        outputs: {},
      },
    },
    { kind: "image" },
  );
  assert.equal(failed.status, "failed");
  assert.match(failed.error.message, /CUDA OOM/);
  const completed = interpretHistory(
    "p1",
    {
      p1: {
        status: { status_str: "success", completed: true },
        outputs: { "7": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } },
      },
    },
    { kind: "image" },
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.asset.contentType, "image/png");
  const outputs = collectHistoryOutputs({
    outputs: {
      "9": { gifs: [{ filename: "clip.mp4", subfolder: "renders", type: "output" }] },
    },
  });
  assert.equal(outputs[0].mediaType, "video");
  assert.equal(outputs[0].contentType, "video/mp4");
});
