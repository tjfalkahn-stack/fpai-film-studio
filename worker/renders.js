import { providers, providerFor } from "./providers/index.js";
import { fail, validateInput, ProviderError } from "./providers/contract.js";

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const stamp = () => new Date().toISOString();
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
  return {
    projectCeiling: amount("RENDER_PROJECT_CEILING_USD", 20),
    sessionCeiling: amount("RENDER_SESSION_CEILING_USD", 10),
    singleCeiling: amount("MAX_SINGLE_JOB_USD", 4),
    sessionId: env.RENDER_SESSION_ID || "foundation-01",
    projectId: env.RENDER_PROJECT_ID || "enemies-closer-ep01",
    liveEnabled:
      env.LIVE_RENDERING_ENABLED === "true" &&
      env.MOCK_E2E_VERIFIED === "true" &&
      (Boolean(env.GEMINI_API_KEY) || comfyConfigured),
  };
}
export function publicRender(row) {
  const input = JSON.parse(row.input_json);
  const capabilities = providerFor(row.provider, {}).capabilities;
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
function inputFrom(body, env) {
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
  const provider = providerFor(input.provider, env);
  validateInput(input, provider.capabilities);
  if (input.projectId !== config(env).projectId)
    fail(
      "PROJECT_SCOPE",
      "Project is not enabled for this render service.",
      403,
    );
  return { input, provider };
}
function liveGate(input, env) {
  if (input.provider === "mock") return;
  if (!config(env).liveEnabled)
    fail(
      "LIVE_DISABLED",
      "Live rendering is disabled. Mock mode is available.",
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
  if (c.hasCharacters && !input.referenceImages.length)
    fail(
      "CONTINUITY_BLOCKED",
      "Character shots require selected reference images.",
    );
}
async function create(request, env) {
  const body = await readBody(request);
  const { input, provider } = inputFrom(body, env);
  const policy = config(env);
  const quote = provider.estimate(input);
  if (body.estimateOnly === true)
    return json({
      ...quote,
      liveEnabled: policy.liveEnabled,
      policy,
      capabilities: provider.capabilities,
    });
  if (
    typeof body.requestKey !== "string" ||
    !/^[\w-]{8,100}$/.test(body.requestKey)
  )
    fail("INVALID_INPUT", "A stable requestKey is required.");
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
  liveGate(input, env);
  if (!env.GENERATION_MEDIA)
    fail("STORAGE_CONFIG", "Render media storage is not configured.", 503);
  if (body.acceptedCost !== quote.estimatedCost)
    fail(
      "QUOTE_CHANGED",
      "Review and accept the current cost before rendering.",
      409,
    );
  if (quote.estimatedCost > policy.singleCeiling)
    fail("COST_CEILING", "Single-render ceiling exceeded.", 409);
  const id = crypto.randomUUID();
  const storedInput = {
    ...input,
    referenceImages: input.referenceImages.map((ref) => ({
      mimeType: ref.mimeType,
    })),
  };
  if (input.referenceImages.length)
    await env.GENERATION_MEDIA.put(
      `render-inputs/${id}.json`,
      JSON.stringify(input),
      { httpMetadata: { contentType: "application/json" } },
    );
  await db
    .prepare(
      `INSERT INTO renders (id,project_id,session_id,scene_id,shot_id,request_key,request_hash,provider,model,status,estimated_cost,reserved_cost,input_json,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?
    WHERE ?=0 OR (
      (SELECT COALESCE(SUM(COALESCE(actual_cost,0)+reserved_cost),0) FROM renders WHERE project_id=?) +
      (SELECT COALESCE(SUM(actual_cost+reserved_cost),0) FROM generation_jobs WHERE project_id=?) + ? <= ?
      AND (SELECT COALESCE(SUM(COALESCE(actual_cost,0)+reserved_cost),0) FROM renders WHERE session_id=?) + ? <= ?)
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
    )
    .run();
  const row = await db
    .prepare("SELECT * FROM renders WHERE project_id=? AND request_key=?")
    .bind(input.projectId, body.requestKey)
    .first();
  if (!row || row.id !== id) {
    if (input.referenceImages.length)
      await env.GENERATION_MEDIA.delete(`render-inputs/${id}.json`);
  }
  if (!row)
    fail(
      "COST_CEILING",
      "Session or project ceiling would be exceeded, including reserved renders.",
      409,
    );
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
  if (row.provider !== "mock" && !config(env).liveEnabled) return row;
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
      if (input.referenceImages.length) {
        const stored = await env.GENERATION_MEDIA.get(
          `render-inputs/${row.id}.json`,
        );
        if (!stored)
          fail(
            "MISSING_REFERENCES",
            "Stored render references are missing.",
            503,
          );
        input = await stored.json();
      }
      const started = await provider.start(input);
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
    if (url.pathname === "/api/renderers" && request.method === "GET")
      return json({
        providers: providers(env).map((p) => p.capabilities),
        policy: config(env),
      });
    if (url.pathname === "/api/renders" && request.method === "POST")
      return await create(request, env);
    if (url.pathname === "/api/renders" && request.method === "GET") {
      const rows = await dbOf(env)
        .prepare(
          "SELECT * FROM renders WHERE project_id=? ORDER BY CASE WHEN status IN ('queued','starting','running','uncertain') OR (status='completed' AND output_key IS NULL) THEN 0 ELSE 1 END, created_at DESC LIMIT 200",
        )
        .bind(config(env).projectId)
        .all();
      return json({ renders: rows.results.map(publicRender) });
    }
    const match = url.pathname.match(
      /^\/api\/renders\/([a-f0-9-]{36})(?:\/(cancel|asset))?$/,
    );
    if (!match)
      return json({ error: { code: "NOT_FOUND", message: "Not found." } }, 404);
    let row = await get(env, match[1]);
    if (!row || row.project_id !== config(env).projectId)
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
