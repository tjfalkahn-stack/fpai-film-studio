import { renderRoutes, config as renderConfig } from "./renders.js";
import { characterReferenceRoutes } from "./characterReferences.js";
import { filmRoutes } from "./filmEngine.js";
import { ROUTES } from "../src/economy.js";

const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_WORKING_CEILING = 200;
const DEFAULT_EMERGENCY_CEILING = 250;
const DEFAULT_SINGLE_JOB_LIMIT = 4;

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...extra },
});

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed.length === 0 ? origin : "";
  return {
    ...(allowOrigin ? { "access-control-allow-origin": allowOrigin } : {}),
    "access-control-allow-headers": "authorization, content-type, x-fpai-owner-override",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function secureCompare(a = "", b = "") {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function authorize(request, env) {
  if (!env.FPAI_CONTROL_TOKEN) return { ok: false, status: 503, error: "FPAI_CONTROL_TOKEN is not configured." };
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!secureCompare(token, env.FPAI_CONTROL_TOKEN)) return { ok: false, status: 401, error: "Unauthorized." };
  return { ok: true };
}

const now = () => new Date().toISOString();
const money = (value) => Math.round((Number(value) || 0) * 10000) / 10000;

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function paidRoute(routeId) {
  const route = ROUTES.find((item) => item.id === routeId);
  if (!route || !route.paid || route.provider !== "google") throw new Error("Route is not an approved paid Google route.");
  return route;
}

function validatePlan(body) {
  const plan = body?.plan;
  if (!body?.requestHash || typeof body.requestHash !== "string" || body.requestHash.length < 8) throw new Error("requestHash is required.");
  if (!body?.projectId || !body?.shotId) throw new Error("projectId and shotId are required.");
  if (!plan?.routeId || !Array.isArray(plan.jobs) || plan.jobs.length === 0) throw new Error("A paid provider plan with jobs is required.");
  if (!plan.prompt || typeof plan.prompt !== "string" || plan.prompt.length > 12000) throw new Error("Prompt is required and must be 12,000 characters or fewer.");

  const route = paidRoute(plan.routeId);
  let seconds = 0;
  for (const job of plan.jobs) {
    if (job.model !== route.model) throw new Error("Client model does not match the approved server route.");
    if (String(job.resolution).toLowerCase() !== String(route.resolution).toLowerCase()) throw new Error("Client resolution does not match the approved server route.");
    const duration = Number(job.durationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid job duration.");
    if (route.durationPolicy === "fixed" && duration !== route.fixedDuration) throw new Error(`Route ${route.id} requires ${route.fixedDuration}-second jobs.`);
    if (route.durationPolicy === "flexible" && (duration < route.minDuration || duration > route.maxDuration)) throw new Error(`Route ${route.id} duration is outside the approved range.`);
    seconds += duration;
  }

  const estimatedCost = money(seconds * route.ratePerSecond);
  return { route, seconds, estimatedCost, plan };
}

async function getProjectSpend(env, projectId) {
  const row = await env.GENERATION_DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'completed' THEN actual_cost ELSE 0 END), 0) AS actual,
      COALESCE(SUM(CASE WHEN status IN ('queued','running') THEN reserved_cost ELSE 0 END), 0) AS reserved
    FROM generation_jobs WHERE project_id = ?
  `).bind(projectId).first();
  return { actual: Number(row?.actual || 0), reserved: Number(row?.reserved || 0) };
}

async function ensureProject(env, projectId) {
  await env.GENERATION_DB.prepare(`
    INSERT INTO generation_projects (project_id, generation_target, working_ceiling, emergency_ceiling, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO NOTHING
  `).bind(projectId, Number(env.GENERATION_TARGET || 125), Number(env.WORKING_GENERATION_CEILING || DEFAULT_WORKING_CEILING), Number(env.EMERGENCY_GENERATION_CEILING || DEFAULT_EMERGENCY_CEILING), now(), now()).run();
  return env.GENERATION_DB.prepare("SELECT * FROM generation_projects WHERE project_id = ?").bind(projectId).first();
}

function ownerOverrideAllowed(request, body) {
  return body?.ownerOverride === true && request.headers.get("x-fpai-owner-override") === "confirm";
}

async function reserveJob(request, env, body, validated) {
  await ensureProject(env, body.projectId);
  const existing = await env.GENERATION_DB.prepare("SELECT * FROM generation_jobs WHERE request_hash = ?").bind(body.requestHash).first();
  if (existing) return { duplicate: true, row: existing };

  const project = await env.GENERATION_DB.prepare("SELECT * FROM generation_projects WHERE project_id = ?").bind(body.projectId).first();
  const spend = await getProjectSpend(env, body.projectId);
  const projected = money(spend.actual + spend.reserved + validated.estimatedCost);
  const ownerOverride = ownerOverrideAllowed(request, body);
  const singleJobLimit = Number(env.MAX_SINGLE_JOB_USD || DEFAULT_SINGLE_JOB_LIMIT);

  if (validated.estimatedCost > singleJobLimit) throw new Error(`Request exceeds the server single-job limit of $${singleJobLimit.toFixed(2)}.`);
  if (validated.route.tier === "standard" && !ownerOverride) throw new Error("Veo Standard requires server-confirmed owner override.");
  if (validated.route.resolution === "4k" && !ownerOverride) throw new Error("4K requires server-confirmed owner override.");
  if (projected > Number(project.emergency_ceiling)) throw new Error("Emergency generation ceiling would be exceeded.");
  if (projected > Number(project.working_ceiling) && !ownerOverride) throw new Error("Working generation ceiling requires server-confirmed owner override.");

  const id = crypto.randomUUID();
  const timestamp = now();
  const promptHash = await sha256(validated.plan.prompt);
  await env.GENERATION_DB.prepare(`
    INSERT INTO generation_jobs
      (id, request_hash, project_id, scene_id, shot_id, route_id, model, resolution, status,
       estimated_cost, reserved_cost, actual_cost, request_seconds, prompt_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?, ?)
  `).bind(id, body.requestHash, body.projectId, body.sceneId || null, body.shotId, validated.route.id, validated.route.model, validated.route.resolution,
    validated.estimatedCost, validated.estimatedCost, validated.seconds, promptHash, timestamp, timestamp).run();
  return { duplicate: false, row: await env.GENERATION_DB.prepare("SELECT * FROM generation_jobs WHERE id = ?").bind(id).first() };
}

async function googleFetch(path, env, init = {}) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured.");
  const headers = new Headers(init.headers || {});
  headers.set("x-goog-api-key", env.GEMINI_API_KEY);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(path.startsWith("http") ? path : `${GOOGLE_BASE}/${path}`, { ...init, headers });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) {
    const message = payload?.error?.message || `Google request failed with HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function findVideoData(payload) {
  const candidates = [
    payload?.outputVideo,
    payload?.output_video,
    payload?.output?.video,
    ...(Array.isArray(payload?.outputs) ? payload.outputs.map((item) => item?.video || item?.outputVideo) : []),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate?.data) return { data: candidate.data, mimeType: candidate.mimeType || candidate.mime_type || "video/mp4" };
    if (candidate?.uri) return { uri: candidate.uri, mimeType: candidate.mimeType || candidate.mime_type || "video/mp4" };
  }
  return null;
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function storeVideo(env, job, video, jobIndex = 0) {
  let bytes;
  let contentType = video.mimeType || "video/mp4";
  if (video.data) {
    bytes = decodeBase64(video.data);
  } else if (video.uri) {
    const headers = new Headers();
    if (video.uri.includes("generativelanguage.googleapis.com")) headers.set("x-goog-api-key", env.GEMINI_API_KEY);
    const response = await fetch(video.uri, { headers, redirect: "follow" });
    if (!response.ok) throw new Error(`Video download failed with HTTP ${response.status}.`);
    contentType = response.headers.get("content-type") || contentType;
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    throw new Error("Google response did not contain downloadable video data.");
  }

  const key = `${job.project_id}/${job.scene_id || "scene"}/${job.shot_id}/${job.id}-${jobIndex}.mp4`;
  await env.GENERATION_MEDIA.put(key, bytes, { httpMetadata: { contentType }, customMetadata: { requestHash: job.request_hash, model: job.model } });
  return key;
}

async function startOmni(env, job, validated) {
  if (validated.plan.jobs.length !== 1) throw new Error("Omni adapter currently accepts one planned clip per request.");
  const providerJob = validated.plan.jobs[0];
  const payload = await googleFetch("interactions", env, {
    method: "POST",
    body: JSON.stringify({
      model: validated.route.model,
      input: validated.plan.prompt,
      response_format: { type: "video", resolution: validated.route.resolution },
      generation_config: { video_config: { duration_seconds: providerJob.durationSeconds, task: "text_to_video" } },
    }),
  });
  const video = findVideoData(payload);
  if (!video) throw new Error("Omni completed without a recognized video output.");
  const outputKey = await storeVideo(env, job, video, 0);
  await completeJob(env, job.id, outputKey, job.estimated_cost, { interactionId: payload?.id || payload?.interaction?.id || null });
}

async function startVeo(env, job, validated) {
  if (validated.plan.jobs.length !== 1) throw new Error("Veo adapter currently accepts one 8-second provider job per request. Split longer shots client-side.");
  const response = await googleFetch(`models/${encodeURIComponent(validated.route.model)}:predictLongRunning`, env, {
    method: "POST",
    body: JSON.stringify({
      instances: [{ prompt: validated.plan.prompt }],
      parameters: { numberOfVideos: 1, resolution: validated.route.resolution },
    }),
  });
  if (!response?.name) throw new Error("Veo did not return a long-running operation name.");
  await env.GENERATION_DB.prepare("UPDATE generation_jobs SET status='running', provider_operation=?, updated_at=? WHERE id=?")
    .bind(response.name, now(), job.id).run();
}

async function completeJob(env, id, outputKey, actualCost, metadata = {}) {
  await env.GENERATION_DB.prepare(`
    UPDATE generation_jobs
    SET status='completed', output_key=?, actual_cost=?, reserved_cost=0, provider_metadata=?, updated_at=?
    WHERE id=?
  `).bind(outputKey, money(actualCost), JSON.stringify(metadata), now(), id).run();
}

async function failJob(env, id, error) {
  await env.GENERATION_DB.prepare(`
    UPDATE generation_jobs SET status='failed', reserved_cost=0, error_message=?, updated_at=? WHERE id=?
  `).bind(String(error?.message || error).slice(0, 2000), now(), id).run();
}

async function startProvider(env, job, validated) {
  try {
    if (validated.route.apiSurface === "interactions") await startOmni(env, job, validated);
    else if (validated.route.apiSurface === "generateVideos") await startVeo(env, job, validated);
    else throw new Error("Unsupported Google API surface.");
  } catch (error) {
    await failJob(env, job.id, error);
    throw error;
  }
}

async function pollVeo(env, job) {
  if (job.status !== "running" || !job.provider_operation) return job;
  const operation = await googleFetch(job.provider_operation, env, { method: "GET" });
  if (!operation?.done) return job;
  if (operation?.error) {
    await failJob(env, job.id, new Error(operation.error.message || "Veo generation failed."));
    return env.GENERATION_DB.prepare("SELECT * FROM generation_jobs WHERE id=?").bind(job.id).first();
  }
  const video = operation?.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
  if (!video?.uri && !video?.data) {
    await failJob(env, job.id, new Error("Veo completed without a downloadable video."));
    return env.GENERATION_DB.prepare("SELECT * FROM generation_jobs WHERE id=?").bind(job.id).first();
  }
  const outputKey = await storeVideo(env, job, video, 0);
  await completeJob(env, job.id, outputKey, job.estimated_cost, { operation: job.provider_operation });
  return env.GENERATION_DB.prepare("SELECT * FROM generation_jobs WHERE id=?").bind(job.id).first();
}

function publicJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestHash: row.request_hash,
    projectId: row.project_id,
    sceneId: row.scene_id,
    shotId: row.shot_id,
    routeId: row.route_id,
    model: row.model,
    resolution: row.resolution,
    status: row.status,
    estimatedCost: Number(row.estimated_cost || 0),
    actualCost: Number(row.actual_cost || 0),
    requestSeconds: Number(row.request_seconds || 0),
    outputKey: row.output_key || null,
    error: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function handleCreate(request, env) {
  const body = await request.json();
  const validated = validatePlan(body);
  const reservation = await reserveJob(request, env, body, validated);
  if (reservation.duplicate) return json({ duplicate: true, job: publicJob(reservation.row) }, 200);
  await startProvider(env, reservation.row, validated);
  const row = await env.GENERATION_DB.prepare("SELECT * FROM generation_jobs WHERE id=?").bind(reservation.row.id).first();
  return json({ duplicate: false, job: publicJob(row) }, 202);
}

async function handleGetJob(env, id) {
  let row = await env.GENERATION_DB.prepare("SELECT * FROM generation_jobs WHERE id=?").bind(id).first();
  if (!row) return json({ error: "Job not found." }, 404);
  if (row.status === "running" && row.provider_operation && renderConfig(env).liveEnabled) row = await pollVeo(env, row);
  return json({ job: publicJob(row) });
}

async function handleMedia(env, id) {
  const row = await env.GENERATION_DB.prepare("SELECT * FROM generation_jobs WHERE id=?").bind(id).first();
  if (!row?.output_key) return json({ error: "Completed media is not available." }, 404);
  const object = await env.GENERATION_MEDIA.get(row.output_key);
  if (!object) return json({ error: "Media object was not found." }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({
        ok: true,
        adapter: "fpai-google-video-v1",
        geminiKeyConfigured: Boolean(env.GEMINI_API_KEY),
        controlTokenConfigured: Boolean(env.FPAI_CONTROL_TOKEN),
        d1Configured: Boolean(env.GENERATION_DB),
        r2Configured: Boolean(env.GENERATION_MEDIA),
        liveExecutionReady: renderConfig(env).liveEnabled && Boolean(env.FPAI_CONTROL_TOKEN && env.GENERATION_DB && env.GENERATION_MEDIA),
        liveRenderingEnabled: renderConfig(env).liveEnabled,
      }, 200, cors);
    }

    const auth = authorize(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status, cors);
    try {
      if (url.pathname.startsWith('/api/projects/') && url.pathname.includes('/film')) {
        const response = await filmRoutes(request, env);
        if (response) return response;
      }
      if (url.pathname.startsWith("/api/projects/") && url.pathname.includes("/characters/")) {
        const response = await characterReferenceRoutes(request, env);
        if (response) {
          for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
          return response;
        }
      }
      if (url.pathname.startsWith("/api/renders") || url.pathname === "/api/renderers") return renderRoutes(request, env);
      if (url.pathname.startsWith("/api/generation-jobs") && request.method === "POST") return json({ error: "Legacy provider execution is disabled. Use /api/renders with the render cost gate." }, 403, cors);
      if (request.method === "POST" && url.pathname === "/api/generation-jobs") {
        const response = await handleCreate(request, env);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      const jobMatch = url.pathname.match(/^\/api\/generation-jobs\/([a-f0-9-]+)$/i);
      if (request.method === "GET" && jobMatch) {
        const response = await handleGetJob(env, jobMatch[1]);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      const mediaMatch = url.pathname.match(/^\/api\/generation-jobs\/([a-f0-9-]+)\/media$/i);
      if (request.method === "GET" && mediaMatch) {
        const response = await handleMedia(env, mediaMatch[1]);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      return json({ error: "Not found." }, 404, cors);
    } catch (error) {
      return json({ error: error?.message || "Unexpected adapter error." }, error?.status && Number.isInteger(error.status) ? error.status : 400, cors);
    }
  },
};
