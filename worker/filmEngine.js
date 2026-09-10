import {
  emptyState,
  reduce,
  CAPABILITIES,
  requireThat,
  delivery,
  activeScript,
  storyGraph,
  continuityReport,
} from "../src/film/engine.ts";
import { extractDocument } from "../src/film/documents.js";
import { selectStoredCharacterReferences } from "./characterReferences.js";
import { MOCK_VIDEO_BASE64 } from "./providers/mock-video.js";
const mockVideoBytes = () =>
  Uint8Array.from(atob(MOCK_VIDEO_BASE64), (c) => c.charCodeAt(0));

const stamp = () => new Date().toISOString();
const reply = (body, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const hash = async (bytes) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const bad = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
async function bounded(request, limit = 1000000) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      bad("Upload exceeds the size limit.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}
async function readJson(request) {
  try {
    return JSON.parse(new TextDecoder().decode(await bounded(request)));
  } catch (error) {
    if (error.status) throw error;
    bad("Invalid JSON.");
  }
}
async function getState(env, projectId, revision) {
  const row =
    revision === undefined
      ? await env.GENERATION_DB.prepare(
          "SELECT * FROM film_heads WHERE project_id=?",
        )
          .bind(projectId)
          .first()
      : await env.GENERATION_DB.prepare(
          "SELECT * FROM film_events WHERE project_id=? AND revision=?",
        )
          .bind(projectId, revision)
          .first();
  if (!row?.snapshot_key) return emptyState(projectId);
  const object = await env.GENERATION_MEDIA.get(row.snapshot_key);
  if (!object)
    bad(
      "Production snapshot is unavailable. Retry without changing your draft.",
      503,
    );
  return object.json();
}
async function sources(env, projectId) {
  return (
    await env.GENERATION_DB.prepare(
      "SELECT * FROM film_sources WHERE project_id=? ORDER BY created_at DESC",
    )
      .bind(projectId)
      .all()
  ).results;
}
async function source(env, projectId, id) {
  const row = await env.GENERATION_DB.prepare(
    "SELECT * FROM film_sources WHERE project_id=? AND id=?",
  )
    .bind(projectId, id)
    .first();
  if (!row) bad("Source not found.", 404);
  return row;
}
const safeName = (name) =>
  name
    .replace(/[\r\n"\\/]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .slice(0, 180);
function validateFile(bytes, file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const starts = (values) => values.every((v, i) => bytes[i] === v);
  const signatures = {
    pdf: () => starts([37, 80, 68, 70, 45]),
    docx: () => starts([80, 75, 3, 4]),
    png: () => starts([137, 80, 78, 71, 13, 10, 26, 10]),
    jpg: () => starts([255, 216, 255]),
    jpeg: () => starts([255, 216, 255]),
    webp: () =>
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP",
    wav: () =>
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WAVE",
    mp3: () =>
      starts([73, 68, 51]) || (bytes[0] === 255 && (bytes[1] & 224) === 224),
    m4a: () => new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp",
    flac: () => new TextDecoder().decode(bytes.slice(0, 4)) === "fLaC",
    ogg: () => new TextDecoder().decode(bytes.slice(0, 4)) === "OggS",
  };
  const types = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    flac: "audio/flac",
    ogg: "audio/ogg",
    fdx: "application/xml",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
  };
  requireThat(
    bytes.length && bytes.length <= 24 * 1024 * 1024,
    "Choose a file between 1 byte and 24 MB.",
  );
  requireThat(types[ext], "Unsupported source file type.");
  if (signatures[ext])
    requireThat(signatures[ext](), "File contents do not match the filename.");
  else {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    requireThat(!value.includes("\0"), "Binary data is not a text source.");
    if (ext === "fdx") extractDocument(bytes, file.name);
  }
  return types[ext];
}
async function upload(request, env, projectId) {
  const bytes = await bounded(request, 25 * 1024 * 1024);
  const form = await new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: bytes,
  }).formData();
  const file = form.get("file");
  requireThat(
    file && typeof file.arrayBuffer === "function",
    "Choose a source file.",
  );
  const data = new Uint8Array(await file.arrayBuffer());
  const mime = validateFile(data, file),
    id = crypto.randomUUID(),
    key = `film/${projectId}/sources/${id}/original`;
  const rights = String(form.get("rightsStatus") || "unknown");
  requireThat(
    [
      "unknown",
      "owned",
      "licensed",
      "permission-recorded",
      "restricted",
    ].includes(rights),
    "Invalid rights status.",
  );
  const filename = String(file.name).slice(0, 200),
    digest = await hash(data),
    created = stamp();
  const latest = await env.GENERATION_DB.prepare(
    "SELECT COALESCE(MAX(source_version),0) AS version FROM film_sources WHERE project_id=? AND filename=?",
  )
    .bind(projectId, filename)
    .first();
  await env.GENERATION_MEDIA.put(key, data, {
    httpMetadata: { contentType: mime },
    customMetadata: { projectId, sourceId: id, sha256: digest },
  });
  try {
    await env.GENERATION_DB.prepare(
      "INSERT INTO film_sources (id,project_id,filename,mime_type,r2_key,byte_size,content_hash,source_version,category,rights_status,provenance,processing_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        projectId,
        filename,
        mime,
        key,
        data.length,
        digest,
        latest.version + 1,
        String(form.get("category") || "document").slice(0, 100),
        rights,
        String(form.get("provenance") || "Owner upload").slice(0, 2000),
        "uploaded",
        created,
      )
      .run();
  } catch (error) {
    await env.GENERATION_MEDIA.delete(key);
    if (String(error).includes("UNIQUE"))
      bad(
        "Another version was uploaded at the same time. Retry this upload.",
        409,
      );
    throw error;
  }
  return reply({ source: await source(env, projectId, id) }, 201);
}
async function assertSourceLinks(command, env, projectId) {
  const ids = [
    ...(command.sourceIds || []),
    ...(command.takes || []),
    command.sourceId,
  ].filter(Boolean);
  for (const id of ids) await source(env, projectId, id);
}
async function applyCommand(state, command, env) {
  const projectId = state.projectId;
  if (
    ["save-cue", "save-audio", "place-clip", "parse-script"].includes(
      command.type,
    )
  )
    await assertSourceLinks(command, env, projectId);
  if (command.type === "parse-script") {
    const row = await source(env, projectId, command.sourceId);
    if (!command.text) {
      const object = await env.GENERATION_MEDIA.get(row.r2_key);
      requireThat(object, "Source bytes are unavailable.");
      command = {
        ...command,
        text: extractDocument(
          new Uint8Array(await object.arrayBuffer()),
          row.filename,
        ).text,
      };
    }
  }
  if (command.type === "create-job") {
    const shot = state.shots.find((s) => s.id === command.shotId);
    requireThat(shot, "Choose a shot.");
    requireThat(
      activeScript(state) && shot.source && !shot.needsReview,
      "Approve a script and review this shot’s source mapping first.",
    );
    requireThat(
      ["approved", "locked"].includes(shot.status),
      "Approve the shot before generation.",
    );
    requireThat(
      !command.provider || command.provider === "mock",
      "Only the mock provider is enabled in the Film Engine foundation.",
    );
    const capability = command.capability || "video";
    requireThat(
      CAPABILITIES.includes(capability),
      "Unsupported provider capability.",
    );
    requireThat(
      Number(command.approvedCostCeiling) === 0,
      "The mock job cost ceiling must be zero.",
    );
    if (capability === "voice")
      requireThat(
        state.audio
          .filter((a) => shot.characters.includes(a.character))
          .every(
            (a) => a.consent === "permission-recorded" || a.consent === "owned",
          ),
        "Record voice consent before preparing a voice job.",
      );
    const selection = await selectStoredCharacterReferences(env, {
      projectId,
      characters: shot.characters,
      shot: {
        subject: shot.subject,
        prompt: shot.prompt,
        move: shot.movement,
        wardrobe: shot.wardrobe,
      },
      providerMaxReferences: 6,
    });
    const lockRows = (
      await env.GENERATION_DB.prepare(
        "SELECT character_id,lock_version,status,manifest_json FROM character_locks WHERE project_id=? AND status IN ('current','stale')",
      )
        .bind(projectId)
        .all()
    ).results;
    for (const id of shot.characters) {
      const lock = lockRows.find(
        (l) => l.character_id === id && l.status === "current",
      );
      requireThat(
        lock,
        `Rebuild the approved reference lock for ${id} before preparing a job.`,
      );
      const manifest = JSON.parse(lock.manifest_json);
      requireThat(
        manifest.primaryIdentityAsset?.approvalState === "approved",
        `Choose an approved Primary Identity for ${id}.`,
      );
      requireThat(
        selection.selected.some(
          (r) =>
            r.characterId === id &&
            r.assetId === manifest.primaryIdentityAsset.id,
        ),
        `The selected references must include ${id}'s locked Primary Identity.`,
      );
    }
    const now = stamp();
    const next = structuredClone(state);
    next.jobs.push({
      id: crypto.randomUUID(),
      shotId: shot.id,
      sceneId: shot.sceneId,
      capability,
      provider: "mock",
      model: "original-test-fixture-v1",
      status: "queued",
      estimatedCost: 0,
      approvedCostCeiling: 0,
      actualCost: 0,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
      prompt: shot.prompt,
      promptVersion: shot.version,
      worldVersion: state.worldVersion,
      characterLocks: Object.fromEntries(
        lockRows
          .filter((r) => shot.characters.includes(r.character_id))
          .map((r) => [r.character_id, r.lock_version]),
      ),
      selection,
      inputAssets: selection.selected.map((r) => r.assetId),
      outputAsset: null,
      error: null,
      revision: "",
      shotVersion: shot.version,
      duration: capability === "video" ? 8 : shot.duration,
    });
    return next;
  }
  if (["advance-job", "cancel-job", "retry-job"].includes(command.type)) {
    const next = structuredClone(state),
      job = next.jobs.find((j) => j.id === command.id);
    requireThat(job, "Job not found.");
    if (command.type === "cancel-job") {
      requireThat(
        ["queued", "processing"].includes(job.status),
        "Only pending mock jobs can cancel.",
      );
      job.status = "cancelled";
    } else if (command.type === "retry-job") {
      requireThat(
        job.status === "failed" && job.retryCount < 2,
        "Only failed mock jobs can retry, at most twice.",
      );
      job.retryCount++;
      job.status = "queued";
      job.error = null;
    } else if (job.status === "queued") job.status = "processing";
    else if (job.status === "processing") {
      const key = `film/${projectId}/jobs/${job.id}/output`;
      try {
        await env.GENERATION_MEDIA.put(
          key,
          job.capability === "video"
            ? mockVideoBytes()
            : JSON.stringify({
                mock: true,
                capability: job.capability,
                message:
                  "Mock capability package. No live image, voice, music, or transcription was generated.",
                prompt: job.prompt,
              }),
          {
            httpMetadata: {
              contentType:
                job.capability === "video" ? "video/mp4" : "application/json",
            },
          },
        );
        job.outputAsset = `/api/projects/${projectId}/film/jobs/${job.id}/asset`;
        job.status = "completed";
      } catch {
        job.status = "failed";
        job.error =
          "Mock output storage failed. Retry after storage is restored.";
      }
    } else bad("Job is not pending.");
    job.updatedAt = stamp();
    return next;
  }
  if (command.type === "place-clip" && command.sourceId) {
    const row = await source(env, projectId, command.sourceId);
    requireThat(
      row.mime_type.startsWith("audio/"),
      "Choose an audio source for an audio lane.",
    );
  }
  if (command.type === "place-clip" && (command.lane || "video") === "video") {
    const job = state.jobs.find((j) => j.id === command.jobId);
    requireThat(
      job?.capability === "video",
      "Only video takes can enter the video lane.",
    );
  }
  return reduce(state, command);
}
async function commandRoute(request, env, projectId) {
  const body = await readJson(request);
  requireThat(
    typeof body.requestKey === "string" &&
      /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestKey),
    "A stable request key is required.",
  );
  requireThat(
    Number.isInteger(body.expectedRevision) && body.expectedRevision >= 0,
    "Expected revision is required.",
  );
  requireThat(
    body.command && typeof body.command.type === "string",
    "Command is required.",
  );
  const db = env.GENERATION_DB,
    digest = await hash(JSON.stringify(body.command));
  const prior = await db
    .prepare("SELECT * FROM film_events WHERE project_id=? AND request_key=?")
    .bind(projectId, body.requestKey)
    .first();
  if (prior) {
    if (prior.request_hash !== digest)
      bad("This request key already belongs to another operation.", 409);
    return reply({ state: await getState(env, projectId), replayed: true });
  }
  const state = await getState(env, projectId);
  if (body.expectedRevision !== state.revision)
    bad(
      "A newer edit was saved. Refresh the production state; your unsaved draft is still available.",
      409,
    );
  const next = await applyCommand(state, body.command, env);
  next.revision = state.revision + 1;
  const encoded = JSON.stringify(next);
  requireThat(
    encoded.length <= 12 * 1024 * 1024,
    "Production snapshot exceeds the foundation limit. Export a checkpoint before importing more revisions.",
  );
  const key = `film/${projectId}/snapshots/${next.revision}-${crypto.randomUUID()}.json`,
    created = stamp();
  await env.GENERATION_MEDIA.put(key, encoded, {
    httpMetadata: { contentType: "application/json" },
  });
  try {
    const sourceId =
      body.command.type === "parse-script"
        ? body.command.sourceId
        : body.command.type === "approve-script"
          ? next.scripts.find((s) => s.id === body.command.id)?.sourceId
          : null;
    await db.batch([
      db
        .prepare(
          "INSERT INTO film_heads(project_id,revision,snapshot_key,updated_at) VALUES (?,0,'',?) ON CONFLICT(project_id) DO NOTHING",
        )
        .bind(projectId, created),
      db
        .prepare(
          "INSERT INTO film_events(project_id,revision,request_key,request_hash,command_type,snapshot_key,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM film_heads WHERE project_id=? AND revision=?)",
        )
        .bind(
          projectId,
          next.revision,
          body.requestKey,
          digest,
          body.command.type,
          key,
          created,
          projectId,
          state.revision,
        ),
      db
        .prepare(
          "UPDATE film_heads SET revision=?,snapshot_key=?,updated_at=? WHERE project_id=? AND revision=? AND EXISTS(SELECT 1 FROM film_events WHERE project_id=? AND revision=? AND snapshot_key=?)",
        )
        .bind(
          next.revision,
          key,
          created,
          projectId,
          state.revision,
          projectId,
          next.revision,
          key,
        ),
      ...(sourceId
        ? [
            db
              .prepare(
                "UPDATE film_sources SET processing_status=? WHERE project_id=? AND id=? AND EXISTS(SELECT 1 FROM film_events WHERE project_id=? AND revision=? AND snapshot_key=?)",
              )
              .bind(
                body.command.type === "approve-script"
                  ? "approved"
                  : "needs_review",
                projectId,
                sourceId,
                projectId,
                next.revision,
                key,
              ),
          ]
        : []),
    ]);
  } catch (error) {
    await env.GENERATION_MEDIA.delete(key);
    if (String(error).includes("UNIQUE"))
      bad(
        "Concurrent update. Refresh and retry with the same request key.",
        409,
      );
    throw error;
  }
  const saved = await db
    .prepare(
      "SELECT snapshot_key FROM film_events WHERE project_id=? AND revision=?",
    )
    .bind(projectId, next.revision)
    .first();
  if (saved?.snapshot_key !== key) {
    await env.GENERATION_MEDIA.delete(key);
    bad("Concurrent update. Refresh before retrying.", 409);
  }
  return reply({ state: next }, 201);
}
export async function filmRoutes(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(
    /^\/api\/projects\/([a-zA-Z0-9_-]{1,100})\/film(?:\/(.*))?$/,
  );
  if (!match) return null;
  const projectId = match[1],
    path = match[2] || "";
  try {
    if (projectId !== (env.RENDER_PROJECT_ID || "enemies-closer-ep01"))
      bad("This project is not authorized for this studio.", 403);
    if (!env.GENERATION_DB || !env.GENERATION_MEDIA)
      bad("Film Engine storage is not configured.", 503);
    if (request.method === "GET" && path === "") {
      const state = await getState(env, projectId);
      return reply({
        state,
        sources: await sources(env, projectId),
        graph: storyGraph(state),
        continuity: continuityReport(state),
        policy: {
          mode: "mock",
          liveEnabled: false,
          capabilities: CAPABILITIES,
        },
      });
    }
    if (path === "commands" && request.method === "POST")
      return await commandRoute(request, env, projectId);
    if (path === "sources" && request.method === "POST")
      return await upload(request, env, projectId);
    if (path === "history" && request.method === "GET")
      return reply({
        events: (
          await env.GENERATION_DB.prepare(
            "SELECT revision,command_type,created_at FROM film_events WHERE project_id=? ORDER BY revision DESC LIMIT 200",
          )
            .bind(projectId)
            .all()
        ).results,
      });
    const src = path.match(/^sources\/([a-f0-9-]{36})\/(asset|text)$/);
    if (src && request.method === "GET") {
      const row = await source(env, projectId, src[1]);
      const object = await env.GENERATION_MEDIA.get(row.r2_key);
      if (!object) bad("Source file unavailable.", 404);
      if (src[2] === "text")
        return reply(
          extractDocument(
            new Uint8Array(await object.arrayBuffer()),
            row.filename,
          ),
        );
      return new Response(object.body, {
        headers: {
          "content-type": row.mime_type,
          "content-disposition": `attachment; filename="${safeName(row.filename)}"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    const asset = path.match(/^jobs\/([a-f0-9-]{36})\/asset$/);
    if (asset && request.method === "GET") {
      const state = await getState(env, projectId);
      const job = state.jobs.find((j) => j.id === asset[1]);
      if (!job?.outputAsset) bad("Take output not found.", 404);
      const object = await env.GENERATION_MEDIA.get(
        `film/${projectId}/jobs/${job.id}/output`,
      );
      if (!object) bad("Take asset unavailable.", 404);
      return new Response(object.body, {
        headers: {
          "content-type":
            job.capability === "video" ? "video/mp4" : "application/json",
          "content-length": String(object.size),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    const deliver = path.match(/^delivery\/([a-f0-9-]{36})$/);
    if (deliver && request.method === "GET") {
      const state = await getState(env, projectId);
      const locks = (
        await env.GENERATION_DB.prepare(
          "SELECT character_id,lock_version,status,manifest_json FROM character_locks WHERE project_id=? ORDER BY character_id,lock_version",
        )
          .bind(projectId)
          .all()
      ).results.map((r) => ({
        ...JSON.parse(r.manifest_json),
        status: r.status,
      }));
      const bundle = delivery(
        state,
        deliver[1],
        await sources(env, projectId),
        locks,
      );
      return new Response(JSON.stringify(bundle, null, 2), {
        headers: {
          "content-type": "application/json",
          "content-disposition": `attachment; filename="${projectId}-delivery-r${state.revision}.json"`,
          "cache-control": "private, no-store",
        },
      });
    }
    return reply({ error: "Film Engine route not found." }, 404);
  } catch (error) {
    const storage = /no such table|D1_|R2_/.test(String(error));
    return reply(
      {
        error: storage
          ? "Film Engine storage is unavailable. Apply the additive film schema and retry."
          : error.status || !(error instanceof TypeError)
            ? error.message
            : "Invalid production input.",
        code: storage ? "STORAGE_UNAVAILABLE" : "FILM_ENGINE_ERROR",
      },
      storage ? 503 : error.status || 400,
    );
  }
}
