import {
  CHARACTER_STILL_CHECKPOINT,
  CHARACTER_STILL_CLIP_VISION,
  CHARACTER_STILL_IPADAPTER,
} from "../src/characterStillStack.js";

export const PREFLIGHT_PNG = { mimeType: "image/png", data: "iVBORw0KGgo=" };

export function objectInfo(classType, files = {}) {
  return {
    [classType]: {
      input: {
        required: Object.fromEntries(
          Object.entries(files).map(([key, values]) => [key, [values]]),
        ),
      },
    },
  };
}

export function readyObjectInfo(classType) {
  if (classType === "CheckpointLoaderSimple") return objectInfo(classType, { ckpt_name: [CHARACTER_STILL_CHECKPOINT] });
  if (classType === "CLIPVisionLoader") return objectInfo(classType, { clip_name: [CHARACTER_STILL_CLIP_VISION] });
  if (classType === "IPAdapterModelLoader")
    return objectInfo(classType, { ipadapter_file: [CHARACTER_STILL_IPADAPTER] });
  return { [classType]: { input: { required: {} } } };
}

export function createComfyFetchMock({
  missingCheckpoint = false,
  missingNodes = [],
  failUpload = false,
  failView = false,
  failHistory = false,
  promptId = "char-job-1",
  outputFile = "jasmine.png",
  inspectPrompt,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", init });
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path === "/system_stats") return Response.json({ system: { comfyui_version: "1.4.7" } });
    if (path === "/queue") return Response.json({ queue_running: [], queue_pending: [] });
    if (path.startsWith("/object_info/")) {
      const classType = decodeURIComponent(path.split("/").pop());
      if (missingNodes.includes(classType)) return Response.json({});
      const payload = readyObjectInfo(classType);
      if (missingCheckpoint && classType === "CheckpointLoaderSimple") {
        payload[classType].input.required.ckpt_name = [["sd_xl_base_1.0.safetensors"]];
      }
      return Response.json(payload);
    }
    if (path === "/models/ipadapter") return Response.json([CHARACTER_STILL_IPADAPTER]);
    if (path === "/models/checkpoints")
      return Response.json(missingCheckpoint ? ["sd_xl_base_1.0.safetensors"] : [CHARACTER_STILL_CHECKPOINT]);
    if (path === "/upload/image") {
      if (failUpload) return new Response(JSON.stringify({ error: "upload failed" }), { status: 500 });
      const file = init.body?.get?.("image");
      return Response.json({ name: file?.name || "probe.png", subfolder: "fpai", type: "input" });
    }
    if (path === "/prompt" && init.method === "POST") {
      const body = JSON.parse(init.body);
      inspectPrompt?.(body);
      return Response.json({ prompt_id: promptId, number: 1, node_errors: {} });
    }
    if (path === `/history/${promptId}`) {
      if (failHistory) {
        return Response.json({
          [promptId]: {
            status: {
              status_str: "error",
              completed: true,
              messages: [["execution_error", { exception_message: "CUDA OOM" }]],
            },
            outputs: {},
          },
        });
      }
      return Response.json({
        [promptId]: {
          status: { status_str: "success", completed: true },
          outputs: { "20": { images: [{ filename: outputFile, subfolder: "", type: "output" }] } },
        },
      });
    }
    if (path === "/view") {
      if (failView) return new Response("missing", { status: 404 });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, calls };
}
