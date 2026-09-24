import { providers, providerFor } from "./providers/index.js";
import { fail, validateInput, ProviderError } from "./providers/contract.js";
import { seedanceLiveEnabled } from "./providers/seedance.js";
import { isSeedanceProvider } from "../src/seedanceRequest.js";
import { isLtxProvider, ltxLiveEnabled } from "./providers/ltx.js";
import { YARD_PROJECT_ID } from "../src/yardProduction.js";
import {
  SEEDANCE_CONTROLLED_TEST,
  seedanceEstimatedCostAllowed,
  seedancePlanMismatches,
} from "../src/seedanceControlledTest.js";
import {
  resolveProviderReferenceImages,
  selectStoredCharacterReferences,
} from "./characterReferences.js";

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const stamp = () => new Date().toISOString();
const LTX_CONTROLLED_TEST = Object.freeze({
  projectId: "enemies-closer-ep01",
  sceneId: "001",
  shotId: "027",
  provider: "ltx-2.5-fast",
  duration: 8,
  resolution: "1080p",
  aspectRatio: "16:9",
  maxEstimatedCostUsd: 1.04,
});
const YARD_LTX_TEST = Object.freeze({ projectId: YARD_PROJECT_ID, sceneId: "YARD", shotId: "PV", provider: "ltx-2.5-fast", duration: 6, resolution: "720p", aspectRatio: "9:16", maxEstimatedCostUsd: 0.54 });
const YARD_SPOKESPERSON_TEST = Object.freeze({ ...YARD_LTX_TEST, shotId: "SPK" });
const allowedProject = (id, env) => id === config(env).projectId || id === YARD_PROJECT_ID;
const dbOf = (env) =>
  env.GENERATION_DB ||
  fail("STORAGE_CONFIG", "Render database is not configured.", 503);
const get = (env, id) =>
  dbOf(env).prepare("SELECT * FROM renders WHERE id=?").bind(id).first();
const sha = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const err = (error) => ({
  code: error.code || "RENDER_ERROR",
  message:
    error instanceof ProviderError
      ? error.message
      : "Render storage or service error. Retry status before submitting again.",
  retryable: Boolean(error.retryable),
  uncertain: Boolean(error.uncertain),
});
export function config(env) {
  const amount = (key, fallback) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isFinite(n) || n < 0)
      fail("INVALID_CONFIG", `${key} must be non-negative.`, 503);
    return n;
  };
  const comfyConfigured = Boolean(
    env.COMFYUI_BASE_URL && (env.COMFYUI_WORKFLOW_KEY || env.COMFYUI_WORKFLOW_JSON),
  );
  const liveMaster =
    env.LIVE_RENDERING_ENABLED === "true" && env.MOCK_E2E_VERIFIED === "true";
  const executionStorageReady = Boolean(
    env.FPAI_CONTROL_TOKEN && env.GENERATION_DB && env.GENERATION_MEDIA,
  );
  const geminiConfigured = Boolean(String(env.GEMINI_API_KEY || "").trim());
  const ltxConfigured = Boolean(String(env.LTX_API_KEY || "").trim());
  const falConfigured = Boolean(String(env.FAL_KEY || "").trim());
  return {
    projectCeiling: amount("RENDER_PROJECT_CEILING_USD", 20),
    sessionCeiling: amount("RENDER_SESSION_CEILING_USD", 10),
    singleCeiling: amount("MAX_SINGLE_JOB_USD", 4),
    sessionId: env.RENDER_SESSION_ID || "foundation-01",
    projectId: env.RENDER_PROJECT_ID || "enemies-closer-ep01",
    liveEnabled: liveMaster && (geminiConfigured || comfyConfigured),
    liveMasterEnabled: liveMaster,
    executionStorageReady,
    geminiConfigured,
    veoExecutionReady: liveMaster && geminiConfigured && executionStorageReady,
    seedanceLiveEnabled: seedanceLiveEnabled(env),
    ltxLiveEnabled: ltxLiveEnabled(env),
    ltxConfigured,
    ltxExecutionReady:
      ltxLiveEnabled(env) && ltxConfigured && executionStorageReady,
    falConfigured,
    seedanceControlledTest: {
      projectId: SEEDANCE_CONTROLLED_TEST.projectId,
      sceneId: SEEDANCE_CONTROLLED_TEST.sceneId,
      shotId: SEEDANCE_CONTROLLED_TEST.shotId,
      provider: SEEDANCE_CONTROLLED_TEST.provider,
      mode: SEEDANCE_CONTROLLED_TEST.mode,
      duration: SEEDANCE_CONTROLLED_TEST.duration,
      resolution: SEEDANCE_CONTROLLED_TEST.resolution,
      generateAudio: SEEDANCE_CONTROLLED_TEST.generateAudio,
      maxEstimatedCostUsd: SEEDANCE_CONTROLLED_TEST.maxEstimatedCostUsd,
      maxJobs: SEEDANCE_CONTROLLED_TEST.maxJobs,
    },
  };
}

function providerAvailability(provider, policy, env) {
  const id = provider.capabilities.id;
  if (id === "mock")
    return { state: "ready", label: "READY", detail: "$0 test renderer" };
  if (provider.capabilities.manual)
    return {
      state: "manual",
      label: provider.capabilities.local ? "LOCAL" : "MANUAL",
      detail: provider.capabilities.local
        ? "Runs outside the cloud adapter"
        : "Handoff workflow, no API submission",
    };
  if (id === "veo-fast") {
    if (!policy.geminiConfigured)
      return { state: "key-needed", label: "KEY NEEDED", detail: "Gemini API key is missing" };
    if (!policy.liveMasterEnabled)
      return { state: "configured", label: "CONFIGURED", detail: "Production master gate is off" };
    if (!policy.executionStorageReady)
      return { state: "blocked", label: "BLOCKED", detail: "Render storage or control token is missing" };
    return { state: "ready", label: "READY", detail: "Veo API and protected render queue are ready" };
  }
  if (isLtxProvider(id)) {
    if (!policy.ltxConfigured)
      return { state: "key-needed", label: "KEY NEEDED", detail: "LTX API key is missing" };
    if (!policy.ltxLiveEnabled)
      return { state: "configured", label: "CONFIGURED", detail: "LTX live gate is off" };
    if (!policy.executionStorageReady)
      return { state: "blocked", label: "BLOCKED", detail: "Render storage or control token is missing" };
    return {
      state: "ready",
      label: "READY",
      detail: id === "ltx-2.5-fast" ? "Authorized for the controlled Shot 027 render" : "API connected; first render remains restricted to Fast",
    };
  }
  if (isSeedanceProvider(id)) {
    if (!policy.falConfigured)
      return { state: "key-needed", label: "KEY NEEDED", detail: "fal.ai key is missing" };
    return policy.seedanceLiveEnabled
      ? { state: "ready", label: "READY", detail: "Controlled Seedance queue is ready" }
      : { state: "configured", label: "CONFIGURED", detail: "Seedance live gate is off" };
  }
  if (id === "comfy-video") {
    const configured = Boolean(
      env.COMFYUI_BASE_URL && (env.COMFYUI_WORKFLOW_KEY || env.COMFYUI_WORKFLOW_JSON),
    );
    return configured
      ? { state: policy.liveMasterEnabled ? "ready" : "configured", label: policy.liveMasterEnabled ? "READY" : "CONFIGURED", detail: policy.liveMasterEnabled ? "ComfyUI endpoint is ready" : "Production master gate is off" }
      : { state: "not-configured", label: "NOT CONFIGURED", detail: "ComfyUI endpoint is missing" };
  }
  return { state: "not-configured", label: "NOT CONFIGURED", detail: "Provider setup is incomplete" };
}
export function providerLiveEnabled(provider, env) {
  if (provider === "mock") return true;
  if (providerFor(provider, env).capabilities.manual) return false;
  if (isSeedanceProvider(provider)) return seedanceLiveEnabled(env);
  if (isLtxProvider(provider)) return ltxLiveEnabled(env);
  return config(env).liveEnabled;
}
export function publicRender(row) {
  const input = JSON.parse(row.input_json);
  const capabilities = providerFor(row.provider, {}).capabilities;
  const selection = input.characterReferenceSelection || null;
  return {
    id: row.id,
    renderId: row.id,
    operationId: row.operation_id,
    projectId: row.project_id,
    sceneId: row.scene_id,
    shotId: row.shot_id,
    provider: row.provider,
    providerLabel: capabilities.label,
    routeId: capabilities.ledgerRoutes?.[input.resolution] || row.provider,
    model: row.model,
    status: row.status,
    estimatedCost: row.estimated_cost,
    actualCost: row.actual_cost,
    reservedCost: row.reserved_cost,
    costBasis: row.cost_basis,
    currency: "USD",
    duration: input.duration,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    outputAsset: row.output_key
      ? { url: `/api/renders/${row.id}/asset`, mimeType: "video/mp4" }
      : null,
    error: row.error_json ? JSON.parse(row.error_json) : null,
    createdAt: row.created_at,
    debug: {
      characterReferenceSelection: selection,
      selectedAssetIds: (selection?.selected || []).map((item) => item.assetId),
      transmittedAssetIds: (selection?.transmitted || []).map((item) => item.assetId),
      lockVersions: selection?.lockVersions || null,
      selectionReasons: (selection?.selected || []).map((item) => ({
        assetId: item.assetId,
        order: item.order,
        reasons: item.reasons,
      })),
      providerMaxReferences: capabilities.maxReferences,
      fallbackApplied: Boolean(selection?.fallbackApplied),
      limitation: selection?.limitation || null,
      referenceImagesTransmitted: Array.isArray(input.referenceImages)
        ? input.referenceImages.length
        : 0,
      generateAudio: input.generateAudio !== false,
      seed: input.seed ?? null,
      endpointId: input.seedanceEndpoint || null,
      rationale: input.routingRationale || null,
    },
  };
}
async function readBody(request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    fail("INVALID_INPUT", "JSON content type is required.", 415);
  const reader = request.body?.getReader();
  if (!reader) fail("INVALID_INPUT", "Request body required.");
  let size = 0;
  const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8500000) {
      await reader.cancel();
      fail("BODY_TOO_LARGE", "Render request exceeds 8.5 MB.", 413);
    }
    chunks.push(value);
  }
  let body;
  try {
    body = JSON.parse(await new Blob(chunks).text());
  } catch {
    fail("INVALID_JSON", "Malformed JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail("INVALID_JSON", "JSON object required.");
  return body;
}
async function attachCharacterReferences(body, input, provider, env) {
  const characterIds = Array.isArray(body.characterIds)
    ? body.characterIds.filter(Boolean)
    : [];
  const characters = Array.isArray(body.characters) && body.characters.length
    ? body.characters
    : characterIds.map((id) => ({ id }));
  if (!characters.length) return input;
  const shot = {
    id: input.shotId,
    scene: input.sceneId,
    subject: body.shotSubject || body.subject || "",
    move: body.shotMove || body.move || "",
    prompt: input.prompt,
    wardrobe: body.wardrobe || "",
    ...(body.shotContext || {}),
  };
  const selection = await selectStoredCharacterReferences(env, {
    projectId: input.projectId,
    characters,
    shot,
    providerMaxReferences: provider.capabilities.maxReferences,
  });
  input.characterReferenceSelection = selection;
  if (provider.capabilities.manual) {
    selection.transmitted = [];
    selection.limitation =
      "Manual handoff: Film Studio selected the references, but no image bytes were transmitted by the adapter.";
    return input;
  }
  const hasInlineBytes = (input.referenceImages || []).some((ref) => ref?.data);
  if (!hasInlineBytes && selection.transmitted.length) {
    input.referenceImages = await resolveProviderReferenceImages(
      env,
      input.projectId,
      selection,
      provider.capabilities,
    );
  }
  return input;
}

async function inputFrom(body, env) {
  const input = Object.fromEntries(
    [
      "projectId",
      "sceneId",
      "shotId",
      "provider",
      "prompt",
      "duration",
      "resolution",
      "aspectRatio",
      "referenceImages",
      "continuity",
    ].map((k) => [k, body[k]]),
  );
  if (!Array.isArray(input.referenceImages)) input.referenceImages = [];
  if (body.generateAudio != null || body.generate_audio != null) {
    input.generateAudio = body.generateAudio ?? body.generate_audio;
  }
  if (body.seed != null) input.seed = body.seed;
  if (body.bitrateMode || body.bitrate_mode) {
    input.bitrateMode = body.bitrateMode || body.bitrate_mode;
  }
  if (body.endFrameImage || body.end_image) {
    input.endFrameImage = body.endFrameImage || body.end_image;
  }
  if (Array.isArray(body.environmentReferences) || Array.isArray(body.sceneReferenceImages)) {
    input.environmentReferences = body.environmentReferences || body.sceneReferenceImages;
  }
  if (body.referenceVideos || body.referenceVideo) {
    input.referenceVideos = Array.isArray(body.referenceVideos)
      ? body.referenceVideos
      : body.referenceVideo
        ? [body.referenceVideo]
        : [];
  }
  if (body.selectionReason) input.selectionReason = body.selectionReason;
  const provider = providerFor(input.provider, env);
  if (!allowedProject(input.projectId, env))
    fail(
      "PROJECT_SCOPE",
      "Project is not enabled for this render service.",
      403,
    );
  await attachCharacterReferences(body, input, provider, env);
  validateInput(input, provider.capabilities);
  return { input, provider };
}
function liveGate(input, provider, env) {
  if (input.provider === "mock") return;
  if (input.projectId === YARD_PROJECT_ID && provider.capabilities.paid && input.provider !== YARD_LTX_TEST.provider)
    fail("YARD_RENDER_GATE", "The Yard paid renderer is gated until its controlled test and current spend quote are approved.", 403);
  if (provider.capabilities.manual)
    fail(
      "MANUAL_PROVIDER",
      "This renderer uses a manual handoff and cannot be submitted to the render queue.",
      409,
    );
  if (!providerLiveEnabled(input.provider, env))
    fail(
      "LIVE_DISABLED",
      isSeedanceProvider(input.provider)
        ? "Seedance live rendering is disabled. Mock mode is available."
        : isLtxProvider(input.provider)
          ? "LTX live rendering is disabled. Mock mode is available."
        : "Live rendering is disabled. Mock mode is available.",
      403,
    );
  const c = input.continuity;
  if (
    !c ||
    c.ready !== true ||
    c.animaticLocked !== true ||
    c.timingApproved !== true
  )
    fail(
      "CONTINUITY_BLOCKED",
      "Character continuity, shot timing, and scene animatic must be approved.",
    );
  if (
    c.hasCharacters &&
    !input.referenceImages.length &&
    !input.characterReferenceSelection?.selected?.length
  )
    fail(
      "CONTINUITY_BLOCKED",
      "Character shots require selected reference images.",
    );
}
function authorizeSeedanceJob(input, quote, env) {
  if (!String(env.FAL_KEY || "").trim()) {
    fail("PROVIDER_CONFIG", "FAL_KEY is not configured.", 503);
  }
  if (!seedanceEstimatedCostAllowed(quote.estimatedCost)) {
    fail(
      "COST_CEILING",
      `Seedance controlled-test ceiling of $${SEEDANCE_CONTROLLED_TEST.maxEstimatedCostUsd} would be exceeded.`,
      409,
    );
  }
  const mismatches = seedancePlanMismatches(input, env);
  if (mismatches.length) {
    fail(
      "SEEDANCE_PLAN_DENIED",
      `Request is outside the authorized Seedance one-job test plan (${mismatches.join(", ")}).`,
      403,
    );
  }
}
function authorizeLtxJob(input, quote, env) {
  if (input.projectId === YARD_PROJECT_ID) {
    const plan = input.shotId === "SPK" ? YARD_SPOKESPERSON_TEST : YARD_LTX_TEST;
    const mismatches = ["projectId", "sceneId", "shotId", "provider", "duration", "resolution", "aspectRatio"].filter((key) => input[key] !== plan[key]);
    if (mismatches.length || input.referenceImages.length !== 1 || quote.estimatedCost > plan.maxEstimatedCostUsd)
      fail("YARD_RENDER_GATE", `The Yard trial permits one PV job and one spokesperson job: each 6 seconds, 720p portrait, LTX Fast, one start frame, and at most $${plan.maxEstimatedCostUsd.toFixed(2)}.`, 403);
    return;
  }
  if (!String(env.LTX_API_KEY || "").trim())
    fail("PROVIDER_CONFIG", "LTX_API_KEY is not configured.", 503);
  const mismatches = [
    "projectId",
    "sceneId",
    "shotId",
    "provider",
    "duration",
    "resolution",
    "aspectRatio",
  ].filter((key) => input[key] !== LTX_CONTROLLED_TEST[key]);
  if (
    mismatches.length ||
    Math.abs(Number(quote.estimatedCost) - LTX_CONTROLLED_TEST.maxEstimatedCostUsd) > 0.0001
  )
    fail(
      "LTX_PLAN_DENIED",
      `The first LTX test is restricted to Scene 001, Shot 027, 8 seconds, 1080p landscape, LTX 2.5 Fast, and $${LTX_CONTROLLED_TEST.maxEstimatedCostUsd.toFixed(2)} (${mismatches.join(", ") || "cost"}).`,
      403,
    );
}
async function create(request, env) {
  const body = await readBody(request);
  const { input, provider } = await inputFrom(body, env);
  const policy = config(env);
  const quote = provider.estimate(input);
  if (quote.rationale) input.routingRationale = quote.rationale;
  if (quote.rationale?.endpointId) input.seedanceEndpoint = quote.rationale.endpointId;
  if (body.estimateOnly === true)
    return json({
      ...quote,
      liveEnabled: policy.liveEnabled,
      seedanceLiveEnabled: policy.seedanceLiveEnabled,
      ltxLiveEnabled: policy.ltxLiveEnabled,
      policy,
      capabilities: provider.capabilities,
      characterReferenceSelection: input.characterReferenceSelection || null,
      debug: {
        characterReferenceSelection: input.characterReferenceSelection || null,
        selectedAssetIds: (input.characterReferenceSelection?.selected || []).map(
          (item) => item.assetId,
        ),
        transmittedAssetIds: (
          input.characterReferenceSelection?.transmitted || []
        ).map((item) => item.assetId),
        lockVersions: input.characterReferenceSelection?.lockVersions || null,
        selectionReasons: (input.characterReferenceSelection?.selected || []).map(
          (item) => ({
            assetId: item.assetId,
            order: item.order,
            reasons: item.reasons,
          }),
        ),
        providerMaxReferences: provider.capabilities.maxReferences,
        fallbackApplied: Boolean(input.characterReferenceSelection?.fallbackApplied),
        limitation: input.characterReferenceSelection?.limitation || null,
        referenceImagesTransmitted: provider.capabilities.manual
          ? 0
          : input.referenceImages.length,
        generateAudio: input.generateAudio !== false,
        rationale: quote.rationale || null,
      },
    });
  if (
    typeof body.requestKey !== "string" ||
    !/^[\w-]{8,100}$/.test(body.requestKey)
  )
    fail("INVALID_INPUT", "A stable requestKey is required.");
  liveGate(input, provider, env);
  if (body.acceptedCost !== quote.estimatedCost)
    fail(
      "QUOTE_CHANGED",
      "Review and accept the current cost before rendering.",
      409,
    );
  if (quote.estimatedCost > policy.singleCeiling)
    fail("COST_CEILING", "Single-render ceiling exceeded.", 409);
  if (isSeedanceProvider(input.provider)) authorizeSeedanceJob(input, quote, env);
  if (isLtxProvider(input.provider)) authorizeLtxJob(input, quote, env);
  const hash = await sha(JSON.stringify(input));
  const db = dbOf(env);
  const existing = await db
    .prepare("SELECT * FROM renders WHERE project_id=? AND request_key=?")
    .bind(input.projectId, body.requestKey)
    .first();
  if (existing) {
    if (existing.request_hash !== hash)
      fail(
        "IDEMPOTENCY_CONFLICT",
        "Request key was already used for different inputs.",
        409,
      );
    return json({ render: publicRender(existing), duplicate: true });
  }
  if (!env.GENERATION_MEDIA)
    fail("STORAGE_CONFIG", "Render media storage is not configured.", 503);
  const id = crypto.randomUUID();
  const storedInput = {
    ...input,
    referenceImages: input.referenceImages.map((ref) => ({
      mimeType: ref.mimeType,
      ...(ref.assetId ? { assetId: ref.assetId, characterId: ref.characterId } : {}),
      ...(ref.role ? { role: ref.role } : {}),
    })),
    environmentReferences: Array.isArray(input.environmentReferences)
      ? input.environmentReferences.map((ref) => ({
          mimeType: ref.mimeType,
          ...(ref.assetId ? { assetId: ref.assetId } : {}),
          role: ref.role || "environment",
        }))
      : undefined,
    endFrameImage: input.endFrameImage
      ? {
          mimeType: input.endFrameImage.mimeType,
          ...(input.endFrameImage.assetId ? { assetId: input.endFrameImage.assetId } : {}),
          role: "end-frame",
        }
      : undefined,
    referenceVideos: Array.isArray(input.referenceVideos)
      ? input.referenceVideos.map((ref) => ({
          ...(ref.url ? { url: ref.url } : {}),
          ...(ref.mimeType ? { mimeType: ref.mimeType } : {}),
          role: "reference-video",
        }))
      : undefined,
    characterReferenceSelection: input.characterReferenceSelection || null,
  };
  const hasInlineBytes =
    input.referenceImages.some((ref) => ref.data) ||
    (input.environmentReferences || []).some((ref) => ref.data) ||
    Boolean(input.endFrameImage?.data) ||
    (input.referenceVideos || []).some((ref) => ref.data);
  if (hasInlineBytes)
    await env.GENERATION_MEDIA.put(
      `render-inputs/${id}.json`,
      JSON.stringify(input),
      { httpMetadata: { contentType: "application/json" } },
    );
  await db
    .prepare(
      `INSERT INTO renders (id,project_id,session_id,scene_id,shot_id,request_key,request_hash,provider,model,status,estimated_cost,reserved_cost,input_json,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?
    WHERE (?=0 OR (
      (SELECT COALESCE(SUM(COALESCE(actual_cost,0)+reserved_cost),0) FROM renders WHERE project_id=?) +
      (SELECT COALESCE(SUM(actual_cost+reserved_cost),0) FROM generation_jobs WHERE project_id=?) + ? <= ?
      AND (SELECT COALESCE(SUM(COALESCE(actual_cost,0)+reserved_cost),0) FROM renders WHERE session_id=?) + ? <= ?))
      AND (?=0 OR (SELECT COUNT(*) FROM renders WHERE provider LIKE 'seedance-%') < ?)
      AND (?=0 OR (SELECT COUNT(*) FROM renders WHERE project_id=? AND shot_id=? AND provider LIKE 'ltx-2.5-%') < 1)
    ON CONFLICT(project_id,request_key) DO NOTHING`,
    )
    .bind(
      id,
      input.projectId,
      policy.sessionId,
      input.sceneId,
      input.shotId,
      body.requestKey,
      hash,
      input.provider,
      provider.capabilities.model,
      quote.estimatedCost,
      quote.estimatedCost,
      JSON.stringify(storedInput),
      stamp(),
      stamp(),
      quote.estimatedCost,
      input.projectId,
      input.projectId,
      quote.estimatedCost,
      policy.projectCeiling,
      policy.sessionId,
      quote.estimatedCost,
      policy.sessionCeiling,
      isSeedanceProvider(input.provider) ? 1 : 0,
      SEEDANCE_CONTROLLED_TEST.maxJobs,
      input.projectId === YARD_PROJECT_ID && isLtxProvider(input.provider) ? 1 : 0,
      YARD_PROJECT_ID,
      input.shotId,
    )
    .run();
  const row = await db
    .prepare("SELECT * FROM renders WHERE project_id=? AND request_key=?")
    .bind(input.projectId, body.requestKey)
    .first();
  if (!row || row.id !== id) {
    if (hasInlineBytes)
      await env.GENERATION_MEDIA.delete(`render-inputs/${id}.json`);
  }
  if (!row) {
    if (isSeedanceProvider(input.provider)) {
      const used = await db
        .prepare(
          "SELECT COUNT(*) AS n FROM renders WHERE provider LIKE 'seedance-%'",
        )
        .first();
      if (Number(used?.n || 0) >= SEEDANCE_CONTROLLED_TEST.maxJobs) {
        fail(
          "SEEDANCE_JOB_LIMIT",
          "The authorized Seedance test allows only one generation. Authorization has failed closed.",
          403,
        );
      }
    }
    fail(
      "COST_CEILING",
      "Session or project ceiling would be exceeded, including reserved renders.",
      409,
    );
  }
  if (row.request_hash !== hash)
    fail(
      "IDEMPOTENCY_CONFLICT",
      "Request key was used for different inputs.",
      409,
    );
  return json({ render: publicRender(row), duplicate: row.id !== id }, 202);
}
export async function advance(env, row) {
  const db = dbOf(env);
  const provider = providerFor(row.provider, env);
  if (row.provider !== "mock" && !providerLiveEnabled(row.provider, env)) return row;
  if (
    row.status === "starting" &&
    Date.now() - Date.parse(row.updated_at) > 120000
  ) {
    await db
      .prepare(
        "UPDATE renders SET status='uncertain',error_json=? WHERE id=? AND status='starting'",
      )
      .bind(
        JSON.stringify({
          code: "INTERRUPTED_START",
          message:
            "Submission was interrupted. Reconcile provider outcome before retrying.",
          uncertain: true,
        }),
        row.id,
      )
      .run();
    return get(env, row.id);
  }
  if (row.status === "queued") {
    const claim = await db
      .prepare(
        "UPDATE renders SET status='starting',updated_at=? WHERE id=? AND status='queued'",
      )
      .bind(stamp(), row.id)
      .run();
    if (!claim.meta.changes) return get(env, row.id);
    try {
      let input = JSON.parse(row.input_json);
      const stored = await env.GENERATION_MEDIA.get(
        `render-inputs/${row.id}.json`,
      );
      if (stored) {
        input = await stored.json();
      } else {
        const refs = input.referenceImages || [];
        const storedInline =
          refs.some((ref) => ref?.mimeType && !ref.assetId) ||
          (input.environmentReferences || []).some(
            (ref) => ref?.mimeType && !ref.assetId,
          ) ||
          Boolean(input.endFrameImage?.mimeType && !input.endFrameImage?.assetId) ||
          (input.referenceVideos || []).some((ref) => ref?.data);
        if (storedInline)
          fail(
            "MISSING_REFERENCES",
            "Stored render references are missing.",
            503,
          );
        else if (input.characterReferenceSelection?.transmitted?.length) {
          input.referenceImages = await resolveProviderReferenceImages(
            env,
            row.project_id,
            input.characterReferenceSelection,
            provider.capabilities,
          );
        }
      }
      const started = await provider.start(input);
      if (started.completedResponse) {
        const key = `renders/${row.project_id}/${row.id}.mp4`;
        await env.GENERATION_MEDIA.put(key, started.completedResponse.body, {
          httpMetadata: { contentType: "video/mp4" },
        });
        await db
          .prepare(
            "UPDATE renders SET status='completed',operation_id=?,output_key=?,actual_cost=estimated_cost,reserved_cost=0,cost_basis=?,error_json=NULL,updated_at=? WHERE id=? AND status='starting'",
          )
          .bind(
            started.operationId,
            key,
            started.costBasis || "completed-usage-at-quoted-rate",
            stamp(),
            row.id,
          )
          .run();
        await env.GENERATION_MEDIA.delete(`render-inputs/${row.id}.json`);
        return get(env, row.id);
      }
      await db
        .prepare(
          "UPDATE renders SET status='running',operation_id=?,updated_at=? WHERE id=? AND status='starting'",
        )
        .bind(started.operationId, stamp(), row.id)
        .run();
    } catch (error) {
      const uncertain = error.uncertain || !(error instanceof ProviderError);
      await db
        .prepare(
          "UPDATE renders SET status=?,reserved_cost=?,actual_cost=?,error_json=?,updated_at=? WHERE id=?",
        )
        .bind(
          uncertain ? "uncertain" : "failed",
          uncertain ? row.reserved_cost : 0,
          uncertain ? null : 0,
          JSON.stringify(err(error)),
          stamp(),
          row.id,
        )
        .run();
    }
    return get(env, row.id);
  }
  if (
    !["running", "completed"].includes(row.status) ||
    (row.status === "completed" && row.output_key)
  )
    return row;
  const lease = Date.now() + 90000;
  const claim = await db
    .prepare(
      "UPDATE renders SET lease_until=? WHERE id=? AND lease_until<? AND status IN ('running','completed')",
    )
    .bind(lease, row.id, Date.now())
    .run();
  if (!claim.meta.changes) return get(env, row.id);
  try {
    if (row.status === "running") {
      const result = await provider.status(row);
      if (result.status === "running") return row;
      await db
        .prepare(
          "UPDATE renders SET status=?,actual_cost=?,reserved_cost=0,cost_basis=?,asset_json=?,error_json=?,updated_at=? WHERE id=? AND lease_until=? AND status='running'",
        )
        .bind(
          result.status,
          result.actualCost ?? 0,
          result.costBasis || null,
          result.asset ? JSON.stringify(result.asset) : null,
          result.error ? JSON.stringify(result.error) : null,
          stamp(),
          row.id,
          lease,
        )
        .run();
      row = await get(env, row.id);
    }
    if (row.status === "completed" && !row.output_key) {
      const response = await provider.asset(row);
      const key = `renders/${row.project_id}/${row.id}.mp4`;
      await env.GENERATION_MEDIA.put(
        key,
        row.provider === "mock" ? await response.arrayBuffer() : response.body,
        { httpMetadata: { contentType: "video/mp4" } },
      );
      await db
        .prepare(
          "UPDATE renders SET output_key=?,error_json=NULL,updated_at=? WHERE id=? AND lease_until=?",
        )
        .bind(key, stamp(), row.id, lease)
        .run();
    }
  } catch (error) {
    await db
      .prepare("UPDATE renders SET error_json=? WHERE id=? AND lease_until=?")
      .bind(JSON.stringify(err(error)), row.id, lease)
      .run();
  } finally {
    await db
      .prepare("UPDATE renders SET lease_until=0 WHERE id=? AND lease_until=?")
      .bind(row.id, lease)
      .run();
  }
  return get(env, row.id);
}
async function cancel(env, row) {
  if (["failed", "canceled", "completed"].includes(row.status)) return row;
  const db = dbOf(env);
  const claim = await db
    .prepare(
      "UPDATE renders SET status='canceled',reserved_cost=0,actual_cost=0,updated_at=? WHERE id=? AND status='queued'",
    )
    .bind(stamp(), row.id)
    .run();
  if (claim.meta.changes) return get(env, row.id);
  row = await get(env, row.id);
  const provider = providerFor(row.provider, env);
  if (row.status === "running" && provider.capabilities.cancelRunning) {
    const result = await provider.cancel(row);
    await db
      .prepare(
        "UPDATE renders SET status='canceled',reserved_cost=0,actual_cost=?,cost_basis=?,updated_at=? WHERE id=? AND status='running' AND lease_until=0",
      )
      .bind(
        Number(result.actualCost ?? 0),
        result.costBasis || null,
        stamp(),
        row.id,
      )
      .run();
    return get(env, row.id);
  }
  fail(
    "CANCEL_UNSUPPORTED",
    "Submission has started. This operation must remain tracked until the provider outcome is known.",
    409,
  );
}
async function asset(request, env, row) {
  if (!row.output_key)
    fail("NO_ASSET", "Completed asset is not available yet.", 404);
  const rangeHeader = request.headers.get("range");
  let range;
  if (rangeHeader) {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2]))
      fail("INVALID_RANGE", "Invalid byte range.", 416);
    if (!match[1]) range = { suffix: Number(match[2]) };
    else {
      const offset = Number(match[1]);
      range = {
        offset,
        ...(match[2] ? { length: Number(match[2]) - offset + 1 } : {}),
      };
      if (
        !Number.isSafeInteger(offset) ||
        (range.length !== undefined && range.length <= 0)
      )
        fail("INVALID_RANGE", "Invalid byte range.", 416);
    }
  }
  const object = await env.GENERATION_MEDIA.get(
    row.output_key,
    range ? { range } : undefined,
  );
  if (!object) fail("NO_ASSET", "Stored asset not found.", 404);
  const headers = new Headers({
    "content-type": "video/mp4",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    etag: object.httpEtag,
  });
  if (object.range) {
    headers.set(
      "content-range",
      `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`,
    );
    headers.set("content-length", String(object.range.length));
  } else headers.set("content-length", String(object.size));
  return new Response(object.body, {
    status: object.range ? 206 : 200,
    headers,
  });
}
export async function renderRoutes(request, env) {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/api/renderers" && request.method === "GET") {
      const policy = config(env);
      return json({
        providers: providers(env).map((p) => ({
          ...p.capabilities,
          availability: providerAvailability(p, policy, env),
        })),
        policy,
      });
    }
    if (url.pathname === "/api/renders" && request.method === "POST")
      return await create(request, env);
    if (url.pathname === "/api/renders" && request.method === "GET") {
      const projectId = url.searchParams.get("projectId") || config(env).projectId;
      if (!allowedProject(projectId, env)) fail("PROJECT_SCOPE", "Project is not enabled for this render service.", 403);
      const rows = await dbOf(env)
        .prepare(
          "SELECT * FROM renders WHERE project_id=? ORDER BY CASE WHEN status IN ('queued','starting','running','uncertain') OR (status='completed' AND output_key IS NULL) THEN 0 ELSE 1 END, created_at DESC LIMIT 200",
        )
        .bind(projectId)
        .all();
      return json({ renders: rows.results.map(publicRender) });
    }
    const match = url.pathname.match(
      /^\/api\/renders\/([a-f0-9-]{36})(?:\/(cancel|asset))?$/,
    );
    if (!match)
      return json({ error: { code: "NOT_FOUND", message: "Not found." } }, 404);
    let row = await get(env, match[1]);
    if (!row || !allowedProject(row.project_id, env))
      fail("NOT_FOUND", "Render not found.", 404);
    if (match[2] === "asset" && request.method === "GET")
      return await asset(request, env, row);
    if (match[2] === "cancel" && request.method === "POST")
      row = await cancel(env, row);
    else if (!match[2] && request.method === "GET")
      row = await advance(env, row);
    else fail("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
    return json({ render: publicRender(row) });
  } catch (error) {
    return json({ error: err(error) }, error.httpStatus || 500);
  }
}
