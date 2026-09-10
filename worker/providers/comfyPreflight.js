import { ProviderError } from "./contract.js";
import { comfyAuthHeaders, comfyBaseUrl, comfyFetch, uploadInputImage } from "./comfyNative.js";
import {
  CHARACTER_STILL_CHECKPOINT,
  CHARACTER_STILL_CLIP_VISION,
  CHARACTER_STILL_CORE_CLASSES,
  CHARACTER_STILL_CUSTOM_NODES,
  CHARACTER_STILL_IPADAPTER,
  CHARACTER_STILL_STACK_ID,
} from "../../src/characterStillStack.js";
import { characterStillWorkflowClassTypes } from "../../src/characterStillWorkflow.js";

const PREFLIGHT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function check(id, ok, detail, extra = {}) {
  return { id, ok: Boolean(ok), detail, ...extra };
}

function comboNames(nodeInfo, inputName) {
  const spec =
    nodeInfo?.input?.required?.[inputName] || nodeInfo?.input?.optional?.[inputName] || [];
  const values = spec[0];
  if (!Array.isArray(values)) return [];
  return values.filter((item) => typeof item === "string");
}

function hasName(names, wanted) {
  const lower = String(wanted).toLowerCase();
  return names.some((name) => String(name).toLowerCase() === lower || String(name).endsWith(wanted));
}

async function readJson(env, fetchImpl, path) {
  const response = await comfyFetch(env, fetchImpl, path, {
    headers: comfyAuthHeaders(env),
  });
  return response.json().catch(() => null);
}

async function readJsonOptional(env, fetchImpl, path) {
  try {
    return await readJson(env, fetchImpl, path);
  } catch (error) {
    if (error instanceof ProviderError && (error.httpStatus === 502 || error.httpStatus === 503)) {
      return null;
    }
    throw error;
  }
}

function nodeFromObjectInfo(payload, classType) {
  if (!payload || typeof payload !== "object") return null;
  if (payload[classType]) return payload[classType];
  const values = Object.values(payload);
  return values.length === 1 && values[0]?.input ? values[0] : null;
}

function missingAction(component, name) {
  return {
    component,
    name,
    action: `Run bash deploy/runpod-comfyui/bootstrap.sh on the RunPod ComfyUI Pod, then restart ComfyUI and re-run preflight. Missing: ${name}.`,
  };
}

export async function runComfyCharacterPreflight(env = {}, fetchImpl = fetch, options = {}) {
  const checks = [];
  const missing = [];
  const skipUpload = options.skipUpload === true;

  try {
    comfyBaseUrl(env);
  } catch (error) {
    const detail = error?.message || "COMFYUI_BASE_URL is not configured.";
    checks.push(check("comfy_reachable", false, detail));
    return summarize(checks, missing, {
      reachable: false,
      error: detail,
    });
  }

  let stats = null;
  try {
    stats = await readJson(env, fetchImpl, "/system_stats");
    checks.push(
      check(
        "comfy_reachable",
        true,
        stats?.system?.comfyui_version
          ? `ComfyUI ${stats.system.comfyui_version} responded on /system_stats.`
          : "ComfyUI responded on /system_stats.",
        { version: stats?.system?.comfyui_version || null },
      ),
    );
  } catch (error) {
    checks.push(check("comfy_reachable", false, error?.message || "ComfyUI could not be reached."));
    missing.push({
      component: "comfy",
      name: "ComfyUI HTTP API",
      action: "Start the RunPod ComfyUI Pod and set COMFYUI_BASE_URL to https://<POD_ID>-8188.proxy.runpod.net.",
    });
    return summarize(checks, missing, { reachable: false });
  }

  const requiredClasses = [
    ...new Set([
      ...CHARACTER_STILL_CORE_CLASSES,
      ...CHARACTER_STILL_CUSTOM_NODES.flatMap((node) => node.requiredClasses),
      ...characterStillWorkflowClassTypes(2),
      "IPAdapterModelLoader",
    ]),
  ];
  const presentClasses = [];
  const missingClasses = [];
  const objectInfoByClass = {};

  for (const classType of requiredClasses) {
    const payload = await readJsonOptional(env, fetchImpl, `/object_info/${encodeURIComponent(classType)}`);
    const node = nodeFromObjectInfo(payload, classType);
    if (node) {
      presentClasses.push(classType);
      objectInfoByClass[classType] = node;
    } else {
      missingClasses.push(classType);
    }
  }

  const customOk = CHARACTER_STILL_CUSTOM_NODES[0].requiredClasses.every((name) => presentClasses.includes(name));
  checks.push(
    check(
      "custom_nodes",
      customOk,
      customOk
        ? "IPAdapter Plus custom nodes are registered."
        : `Missing Comfy class types: ${missingClasses.join(", ") || "unknown"}.`,
      { missingClasses },
    ),
  );
  if (!customOk) {
    missing.push(missingAction("custom_node", CHARACTER_STILL_CUSTOM_NODES[0].id));
    for (const classType of missingClasses.filter((name) =>
      CHARACTER_STILL_CUSTOM_NODES[0].requiredClasses.includes(name),
    )) {
      missing.push(missingAction("node_class", classType));
    }
  }

  let checkpointNames = comboNames(objectInfoByClass.CheckpointLoaderSimple, "ckpt_name");
  if (!checkpointNames.length) {
    const listed = await readJsonOptional(env, fetchImpl, "/models/checkpoints");
    checkpointNames = Array.isArray(listed) ? listed.map((item) => item?.name || item).filter(Boolean) : [];
  }
  const checkpointOk = hasName(checkpointNames, CHARACTER_STILL_CHECKPOINT);
  checks.push(
    check(
      "checkpoint",
      checkpointOk,
      checkpointOk
        ? `${CHARACTER_STILL_CHECKPOINT} is installed.`
        : `${CHARACTER_STILL_CHECKPOINT} is not in ComfyUI checkpoints.`,
      { available: checkpointNames },
    ),
  );
  if (!checkpointOk) missing.push(missingAction("checkpoint", CHARACTER_STILL_CHECKPOINT));

  const clipNames = comboNames(objectInfoByClass.CLIPVisionLoader, "clip_name");
  const clipOk = hasName(clipNames, CHARACTER_STILL_CLIP_VISION);
  checks.push(
    check(
      "clip_vision",
      clipOk,
      clipOk
        ? `${CHARACTER_STILL_CLIP_VISION} is installed.`
        : `${CHARACTER_STILL_CLIP_VISION} is not in CLIP vision models.`,
      { available: clipNames },
    ),
  );
  if (!clipOk) missing.push(missingAction("clip_vision", CHARACTER_STILL_CLIP_VISION));

  const ipadapterNames = comboNames(objectInfoByClass.IPAdapterModelLoader, "ipadapter_file");
  const listedIpadapter = await readJsonOptional(env, fetchImpl, "/models/ipadapter");
  const listedIpadapterNames = Array.isArray(listedIpadapter)
    ? listedIpadapter.map((item) => item?.name || item).filter(Boolean)
    : [];
  const ipadapterCatalog = [...new Set([...ipadapterNames, ...listedIpadapterNames])];
  const ipadapterOk = hasName(ipadapterCatalog, CHARACTER_STILL_IPADAPTER);
  checks.push(
    check(
      "ipadapter",
      ipadapterOk,
      ipadapterOk
        ? `${CHARACTER_STILL_IPADAPTER} is available to IPAdapter Plus.`
        : `${CHARACTER_STILL_IPADAPTER} was not listed. Re-run bootstrap and restart ComfyUI.`,
      { available: ipadapterCatalog },
    ),
  );
  if (!ipadapterOk) missing.push(missingAction("ipadapter", CHARACTER_STILL_IPADAPTER));

  const workflowClasses = characterStillWorkflowClassTypes(2);
  const workflowOk = workflowClasses.every((name) => presentClasses.includes(name));
  checks.push(
    check(
      "workflow_compatible",
      workflowOk,
      workflowOk
        ? "FPAI photoreal identity workflow class types are present."
        : `Workflow needs missing nodes: ${workflowClasses.filter((name) => !presentClasses.includes(name)).join(", ")}.`,
      { classTypes: workflowClasses },
    ),
  );

  let queueOk = false;
  try {
    await readJson(env, fetchImpl, "/queue");
    queueOk = true;
  } catch {
    queueOk = false;
  }
  checks.push(
    check(
      "output_writable",
      queueOk,
      queueOk
        ? "ComfyUI queue endpoint responded; output directory is reachable."
        : "Could not read /queue; Comfy may not be able to write outputs.",
    ),
  );
  if (!queueOk) {
    missing.push({
      component: "output",
      name: "ComfyUI output/queue",
      action: "Confirm the Pod can write to ComfyUI/output and that port 8188 is the stock ComfyUI server.",
    });
  }

  let uploadOk = skipUpload;
  let uploadedName = null;
  if (!skipUpload) {
    try {
      uploadedName = await uploadInputImage(
        env,
        fetchImpl,
        { mimeType: "image/png", data: PREFLIGHT_PNG },
        0,
      );
      uploadOk = typeof uploadedName === "string" && uploadedName.startsWith("fpai/");
    } catch (error) {
      uploadOk = false;
      checks.push(
        check("reference_upload", false, error?.message || "Reference upload failed."),
      );
      missing.push({
        component: "upload",
        name: "POST /upload/image",
        action: "Confirm native ComfyUI is on port 8188 and input/fpai exists (bootstrap creates it).",
      });
    }
  }
  if (uploadOk) {
    checks.push(
      check(
        "reference_upload",
        true,
        uploadedName
          ? `Uploaded preflight probe to ${uploadedName}.`
          : "Reference upload check skipped.",
      ),
    );
  }

  return summarize(checks, missing, {
    reachable: true,
    version: stats?.system?.comfyui_version || null,
  });
}

function summarize(checks, missing, extra = {}) {
  const uniqueMissing = [];
  const seen = new Set();
  for (const item of missing) {
    const key = `${item.component}:${item.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueMissing.push(item);
  }
  const ready = checks.length > 0 && checks.every((item) => item.ok) && uniqueMissing.length === 0;
  return {
    schema: "fpai.character-factory.preflight.v1",
    stackId: CHARACTER_STILL_STACK_ID,
    ready,
    liveGenerationEnabled: false,
    checks,
    missing: uniqueMissing,
    ...extra,
  };
}

export function assertComfyCharacterReady(preflight) {
  if (preflight?.ready) return preflight;
  const names = (preflight?.missing || []).map((item) => item.name).join(", ") || "unknown components";
  const action = preflight?.missing?.[0]?.action || "Run deploy/runpod-comfyui/bootstrap.sh on the Pod and restart ComfyUI.";
  throw new ProviderError(
    "COMFY_PREFLIGHT",
    `Character Factory Comfy environment is incomplete (${names}). ${action}`,
    { httpStatus: 503, retryable: false },
  );
}
