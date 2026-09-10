import { fail, ProviderError } from "./providers/contract.js";
import {
  MAX_REFERENCES_PER_CHARACTER,
  DEFAULT_SUPPORTING_REFERENCE_LIMIT,
  buildCharacterLockManifest,
  evaluateReferenceCoverage,
  normalizeApprovalState,
  normalizeAngle,
  normalizeCategory,
  normalizeExpression,
  normalizeLibraryAsset,
  normalizeReferenceLibrary,
  normalizeTags,
  selectGenerationReferences,
  shouldInvalidateLock,
} from "../src/characterReferences.js";
import {
  extensionForMime,
  validateReferenceFile,
} from "../src/imageMeta.js";

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const stamp = () => new Date().toISOString();

const SCOPE_ID = /^[a-zA-Z0-9_-]{1,100}$/;

function dbOf(env) {
  return env.GENERATION_DB || fail("STORAGE_CONFIG", "Character database is not configured.", 503);
}

function mediaOf(env) {
  return env.GENERATION_MEDIA || fail("STORAGE_CONFIG", "Character media storage is not configured.", 503);
}

function expectedProject(env) {
  return env.RENDER_PROJECT_ID || "enemies-closer-ep01";
}

function assertScope(projectId, characterId, env) {
  if (!SCOPE_ID.test(projectId) || !SCOPE_ID.test(characterId)) {
    fail("INVALID_INPUT", "Invalid project or character id.");
  }
  if (projectId !== expectedProject(env)) {
    fail("PROJECT_SCOPE", "Project is not enabled for this character service.", 403);
  }
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeFilename(name, mimeType) {
  const base = String(name || "reference")
    .split(/[/\\]/)
    .pop()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  const hasExt = /\.(jpe?g|png|webp)$/i.test(base);
  const fallback = `reference.${extensionForMime(mimeType)}`;
  return (hasExt ? base : `${base || "reference"}.${extensionForMime(mimeType)}`) || fallback;
}

function r2Key(projectId, characterId, assetId, filename) {
  return `character-refs/${projectId}/${characterId}/${assetId}/${filename}`;
}

function assetUrl(projectId, characterId, id) {
  return `/api/projects/${projectId}/characters/${characterId}/references/${id}/asset`;
}

function publicAsset(row, envProject) {
  const asset = normalizeLibraryAsset({
    ...row,
    tags: row.tags,
    assetUrl: assetUrl(row.project_id, row.character_id, row.id),
  });
  asset.projectId = envProject || row.project_id;
  return asset;
}

async function listAssets(env, projectId, characterId) {
  const result = await dbOf(env)
    .prepare(
      "SELECT * FROM character_references WHERE project_id=? AND character_id=? ORDER BY sort_order ASC, created_at ASC",
    )
    .bind(projectId, characterId)
    .all();
  return (result.results || []).map((row) => publicAsset(row, projectId));
}

async function getAssetRow(env, projectId, characterId, id) {
  return dbOf(env)
    .prepare("SELECT * FROM character_references WHERE id=? AND project_id=? AND character_id=?")
    .bind(id, projectId, characterId)
    .first();
}

async function currentLock(env, projectId, characterId) {
  return dbOf(env)
    .prepare(
      "SELECT * FROM character_locks WHERE project_id=? AND character_id=? AND status IN ('current','stale') ORDER BY lock_version DESC LIMIT 1",
    )
    .bind(projectId, characterId)
    .first();
}

async function markLockStale(env, projectId, characterId) {
  await dbOf(env)
    .prepare(
      "UPDATE character_locks SET status='stale' WHERE project_id=? AND character_id=? AND status='current'",
    )
    .bind(projectId, characterId)
    .run();
}

function supportingLimit(env) {
  const value = Number(env.CHARACTER_REFERENCE_SUPPORTING_LIMIT ?? DEFAULT_SUPPORTING_REFERENCE_LIMIT);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_SUPPORTING_REFERENCE_LIMIT;
  return Math.min(20, Math.floor(value));
}

function parseTags(value) {
  if (Array.isArray(value)) return normalizeTags(value);
  if (typeof value === "string") return normalizeTags(value);
  return [];
}

async function enforceSinglePrimary(env, projectId, characterId, assetId) {
  const db = dbOf(env);
  const now = stamp();
  await db.batch([
    db
      .prepare(
        "UPDATE character_references SET is_primary=0, updated_at=? WHERE project_id=? AND character_id=? AND id!=?",
      )
      .bind(now, projectId, characterId, assetId),
    db
      .prepare(
        "UPDATE character_references SET is_primary=1, is_identity_anchor=1, approval_state='approved', include_in_generation=1, updated_at=? WHERE id=? AND project_id=? AND character_id=?",
      )
      .bind(now, assetId, projectId, characterId),
  ]);
}

async function handleUpload(request, env, projectId, characterId) {
  mediaOf(env);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    fail("INVALID_INPUT", "multipart/form-data is required for reference uploads.", 415);
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    fail("INVALID_INPUT", "An image file is required.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateReferenceFile({
    bytes,
    mimeType: file.type || form.get("mimeType"),
    filename: file.name || form.get("filename"),
    byteSize: bytes.byteLength,
  });
  if (!validated.ok) fail("INVALID_FILE", validated.errors[0], 400);

  const existingCount = await dbOf(env)
    .prepare("SELECT COUNT(*) AS count FROM character_references WHERE project_id=? AND character_id=?")
    .bind(projectId, characterId)
    .first();
  if (Number(existingCount?.count || 0) >= MAX_REFERENCES_PER_CHARACTER) {
    fail("LIBRARY_FULL", `Each character can store at most ${MAX_REFERENCES_PER_CHARACTER} individual reference photos.`);
  }

  const contentHash = await sha256Hex(bytes);
  const duplicate = await dbOf(env)
    .prepare(
      "SELECT * FROM character_references WHERE project_id=? AND character_id=? AND content_hash=?",
    )
    .bind(projectId, characterId, contentHash)
    .first();
  if (duplicate) {
    return json(
      {
        error: {
          code: "DUPLICATE_REFERENCE",
          message: "This exact image is already in the character library.",
        },
        reference: publicAsset(duplicate, projectId),
        duplicate: true,
      },
      409,
    );
  }

  const id = crypto.randomUUID();
  const filename = safeFilename(validated.filename, validated.mimeType);
  const key = r2Key(projectId, characterId, id, filename);
  const maxSort = await dbOf(env)
    .prepare(
      "SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM character_references WHERE project_id=? AND character_id=?",
    )
    .bind(projectId, characterId)
    .first();
  const wantPrimary = String(form.get("isPrimary") || "") === "true" || String(form.get("is_primary") || "") === "1";
  const wantAnchor =
    wantPrimary ||
    String(form.get("isIdentityAnchor") || form.get("is_identity_anchor") || "") === "true" ||
    String(form.get("isIdentityAnchor") || "") === "1";
  const now = stamp();
  const row = {
    id,
    project_id: projectId,
    character_id: characterId,
    r2_key: key,
    filename,
    mime_type: validated.mimeType,
    byte_size: validated.byteSize,
    width: validated.width,
    height: validated.height,
    content_hash: contentHash,
    category: normalizeCategory(form.get("category")),
    angle: normalizeAngle(form.get("angle")),
    expression: normalizeExpression(form.get("expression")),
    wardrobe: String(form.get("wardrobe") || "").trim().slice(0, 80),
    tags: JSON.stringify(parseTags(form.get("tags"))),
    approval_state: normalizeApprovalState(form.get("approvalState") || form.get("approval_state") || "pending"),
    is_primary: 0,
    is_identity_anchor: wantAnchor ? 1 : 0,
    include_in_generation: 1,
    sort_order: Number(maxSort?.max_sort ?? -1) + 1,
    created_at: now,
    updated_at: now,
  };

  await mediaOf(env).put(key, bytes, {
    httpMetadata: { contentType: validated.mimeType },
    customMetadata: {
      projectId,
      characterId,
      assetId: id,
      contentHash,
      filename,
    },
  });

  try {
    await dbOf(env)
      .prepare(
        `INSERT INTO character_references (
          id, project_id, character_id, r2_key, filename, mime_type, byte_size, width, height, content_hash,
          category, angle, expression, wardrobe, tags, approval_state, is_primary, is_identity_anchor,
          include_in_generation, sort_order, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        row.id,
        row.project_id,
        row.character_id,
        row.r2_key,
        row.filename,
        row.mime_type,
        row.byte_size,
        row.width,
        row.height,
        row.content_hash,
        row.category,
        row.angle,
        row.expression,
        row.wardrobe,
        row.tags,
        row.approval_state,
        row.is_primary,
        row.is_identity_anchor,
        row.include_in_generation,
        row.sort_order,
        row.created_at,
        row.updated_at,
      )
      .run();
  } catch (error) {
    await mediaOf(env).delete(key);
    throw error;
  }

  if (wantPrimary) await enforceSinglePrimary(env, projectId, characterId, id);
  await markLockStale(env, projectId, characterId);
  const stored = await getAssetRow(env, projectId, characterId, id);
  return json({ reference: publicAsset(stored, projectId), coverage: evaluateReferenceCoverage(await listAssets(env, projectId, characterId)) }, 201);
}

function patchFromBody(body = {}) {
  const patch = {};
  if (body.category != null) patch.category = normalizeCategory(body.category);
  if (body.angle != null) patch.angle = normalizeAngle(body.angle);
  if (body.expression != null) patch.expression = normalizeExpression(body.expression);
  if (body.wardrobe != null) patch.wardrobe = String(body.wardrobe).trim().slice(0, 80);
  if (body.tags != null) patch.tags = JSON.stringify(parseTags(body.tags));
  if (body.approvalState != null || body.approval_state != null) {
    patch.approval_state = normalizeApprovalState(body.approvalState || body.approval_state);
    if (patch.approval_state === "excluded") patch.include_in_generation = 0;
  }
  if (body.includeInGeneration != null || body.include_in_generation != null) {
    patch.include_in_generation = body.includeInGeneration ?? body.include_in_generation ? 1 : 0;
    if (patch.include_in_generation === 0 && patch.approval_state == null) patch.approval_state = "excluded";
    if (patch.include_in_generation === 1 && patch.approval_state === "excluded") patch.approval_state = "approved";
  }
  if (body.isIdentityAnchor != null || body.is_identity_anchor != null) {
    patch.is_identity_anchor = body.isIdentityAnchor ?? body.is_identity_anchor ? 1 : 0;
    if (patch.is_identity_anchor === 1 && patch.approval_state !== "excluded") {
      patch.approval_state = patch.approval_state || "approved";
    }
  }
  if (body.isPrimary != null || body.is_primary != null) patch.is_primary = body.isPrimary ?? body.is_primary ? 1 : 0;
  if (body.sortOrder != null || body.sort_order != null) {
    patch.sort_order = Math.max(0, Math.round(Number(body.sortOrder ?? body.sort_order) || 0));
  }
  return patch;
}

async function applyPatch(env, projectId, characterId, id, patch) {
  const row = await getAssetRow(env, projectId, characterId, id);
  if (!row) fail("NOT_FOUND", "Reference image not found.", 404);
  const next = { ...row, ...patch, updated_at: stamp() };
  if (patch.approval_state === "excluded") {
    next.include_in_generation = 0;
    next.is_primary = 0;
  }
  await dbOf(env)
    .prepare(
      `UPDATE character_references SET
        category=?, angle=?, expression=?, wardrobe=?, tags=?, approval_state=?,
        is_primary=?, is_identity_anchor=?, include_in_generation=?, sort_order=?, updated_at=?
      WHERE id=? AND project_id=? AND character_id=?`,
    )
    .bind(
      next.category,
      next.angle,
      next.expression,
      next.wardrobe,
      next.tags,
      next.approval_state,
      next.is_primary ? 1 : 0,
      next.is_identity_anchor ? 1 : 0,
      next.include_in_generation ? 1 : 0,
      next.sort_order,
      next.updated_at,
      id,
      projectId,
      characterId,
    )
    .run();
  if (patch.is_primary) await enforceSinglePrimary(env, projectId, characterId, id);
  else if (patch.is_primary === 0 && row.is_primary) {
    await dbOf(env)
      .prepare("UPDATE character_references SET is_primary=0, updated_at=? WHERE id=?")
      .bind(next.updated_at, id)
      .run();
  }
  await markLockStale(env, projectId, characterId);
  return getAssetRow(env, projectId, characterId, id);
}

async function handleReorder(env, projectId, characterId, orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
    fail("INVALID_INPUT", "orderedIds must be an array of asset ids.");
  }
  const existing = await listAssets(env, projectId, characterId);
  const known = new Set(existing.map((asset) => asset.id));
  if (orderedIds.length !== existing.length || orderedIds.some((id) => !known.has(id))) {
    fail("INVALID_INPUT", "orderedIds must include every reference exactly once.");
  }
  const now = stamp();
  const statements = orderedIds.map((id, index) =>
    dbOf(env)
      .prepare("UPDATE character_references SET sort_order=?, updated_at=? WHERE id=? AND project_id=? AND character_id=?")
      .bind(index, now, id, projectId, characterId),
  );
  if (statements.length) await dbOf(env).batch(statements);
  await markLockStale(env, projectId, characterId);
  return listAssets(env, projectId, characterId);
}

async function handleDelete(env, projectId, characterId, id) {
  const row = await getAssetRow(env, projectId, characterId, id);
  if (!row) fail("NOT_FOUND", "Reference image not found.", 404);
  const preserved = await dbOf(env).prepare(
    "SELECT id FROM character_locks WHERE project_id=? AND character_id=? AND manifest_json LIKE ? LIMIT 1",
  ).bind(projectId, characterId, `%\"${id}\"%`).first();
  if (preserved) fail("REFERENCE_PRESERVED", "This image belongs to a saved Character Lock. Exclude it from future generation to preserve earlier takes and versions.", 409);
  await dbOf(env)
    .prepare("DELETE FROM character_references WHERE id=? AND project_id=? AND character_id=?")
    .bind(id, projectId, characterId)
    .run();
  try {
    await mediaOf(env).delete(row.r2_key);
  } catch {
    // Metadata is already gone; leftover R2 objects are orphaned and must not resurrect the row.
  }
  await markLockStale(env, projectId, characterId);
  return json({ deleted: true, id, coverage: evaluateReferenceCoverage(await listAssets(env, projectId, characterId)) });
}

async function handleRebuildLock(env, projectId, characterId) {
  const assets = await listAssets(env, projectId, characterId);
  const latest = await dbOf(env)
    .prepare(
      "SELECT MAX(lock_version) AS max_version FROM character_locks WHERE project_id=? AND character_id=?",
    )
    .bind(projectId, characterId)
    .first();
  const lockVersion = Number(latest?.max_version || 0) + 1;
  const createdAt = stamp();
  const manifest = buildCharacterLockManifest({
    projectId,
    characterId,
    lockVersion,
    assets,
    createdAt,
  });
  await dbOf(env)
    .prepare(
      "UPDATE character_locks SET status='archived' WHERE project_id=? AND character_id=? AND status IN ('current','stale')",
    )
    .bind(projectId, characterId)
    .run();
  await dbOf(env)
    .prepare(
      "INSERT INTO character_locks (id, project_id, character_id, lock_version, status, manifest_json, created_at) VALUES (?,?,?,?, 'current', ?, ?)",
    )
    .bind(crypto.randomUUID(), projectId, characterId, lockVersion, JSON.stringify(manifest), createdAt)
    .run();
  return json({ lock: { ...manifest, status: "current" }, coverage: evaluateReferenceCoverage(assets) }, 201);
}

async function lockState(env, projectId, characterId, assets) {
  const library = assets || (await listAssets(env, projectId, characterId));
  const versions = await dbOf(env)
    .prepare(
      "SELECT lock_version, status, created_at, manifest_json FROM character_locks WHERE project_id=? AND character_id=? ORDER BY lock_version DESC",
    )
    .bind(projectId, characterId)
    .all();
  const current = (versions.results || []).find((row) => row.status === "current" || row.status === "stale") || null;
  const manifest = current ? JSON.parse(current.manifest_json) : null;
  return {
    lock: manifest
      ? {
          ...manifest,
          status: current.status,
          needsRebuild: current.status === "stale" || shouldInvalidateLock(manifest, library),
        }
      : null,
    versions: (versions.results || []).map((row) => ({
      lockVersion: row.lock_version,
      status: row.status,
      createdAt: row.created_at,
    })),
    coverage: evaluateReferenceCoverage(library),
  };
}

async function handleGetLock(env, projectId, characterId) {
  return json(await lockState(env, projectId, characterId));
}

export async function loadCharacterLibraries(env, projectId, characterIds = []) {
  const libraries = {};
  const lockVersions = {};
  for (const characterId of characterIds) {
    if (!SCOPE_ID.test(characterId)) continue;
    libraries[characterId] = await listAssets(env, projectId, characterId);
    const lock = await currentLock(env, projectId, characterId);
    lockVersions[characterId] = lock?.lock_version || null;
  }
  return { libraries, lockVersions };
}

export async function selectStoredCharacterReferences(env, { projectId, characters, shot, providerMaxReferences }) {
  const ids = (characters || []).map((item) => item.id || item).filter(Boolean);
  const { libraries, lockVersions } = await loadCharacterLibraries(env, projectId, ids);
  return selectGenerationReferences({
    characters: (characters || []).map((item) => (typeof item === "string" ? { id: item } : item)),
    libraries,
    shot,
    supportingLimit: supportingLimit(env),
    providerMaxReferences,
    lockVersions,
  });
}

async function handleSelection(request, env, projectId, characterId) {
  const body = await request.json().catch(() => ({}));
  const characterIds = body.characterIds || [characterId];
  const characters = characterIds.map((id) => ({ id, name: body.names?.[id], wardrobe: body.wardrobe }));
  const selection = await selectStoredCharacterReferences(env, {
    projectId,
    characters,
    shot: { id: body.shotId, subject: body.subject, move: body.move, prompt: body.prompt, wardrobe: body.wardrobe, ...(body.shot || {}) },
    providerMaxReferences: body.providerMaxReferences,
  });
  return json({ selection });
}

function matchPath(pathname) {
  const library = pathname.match(
    /^\/api\/projects\/([^/]+)\/characters\/([^/]+)\/references(?:\/([a-f0-9-]{36})(?:\/(asset))?)?$/,
  );
  if (library) {
    return {
      projectId: library[1],
      characterId: library[2],
      assetId: library[3] || null,
      asset: library[4] === "asset",
      lock: false,
      selection: false,
    };
  }
  const lock = pathname.match(/^\/api\/projects\/([^/]+)\/characters\/([^/]+)\/lock$/);
  if (lock) return { projectId: lock[1], characterId: lock[2], lock: true };
  const selection = pathname.match(
    /^\/api\/projects\/([^/]+)\/characters\/([^/]+)\/reference-selection$/,
  );
  if (selection) return { projectId: selection[1], characterId: selection[2], selection: true };
  return null;
}

async function handleAsset(request, env, row) {
  const object = await mediaOf(env).get(row.r2_key);
  if (!object) fail("NO_ASSET", "Stored reference image was not found.", 404);
  const headers = new Headers({
    "content-type": row.mime_type || object.httpMetadata?.contentType || "application/octet-stream",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  });
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

function bufferToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function resolveProviderReferenceImages(env, projectId, selection, capabilities) {
  const allowInlineOnly = capabilities?.id !== "mock";
  const max = Number(capabilities?.maxReferences);
  const source = Array.isArray(selection?.transmitted) && selection.transmitted.length
    ? selection.transmitted
    : selection?.selected || [];
  const usable = source.filter((item) =>
    allowInlineOnly ? item.mimeType === "image/png" || item.mimeType === "image/jpeg" : true,
  );
  const limited = Number.isFinite(max) ? usable.slice(0, Math.max(0, max)) : usable;
  if (capabilities?.id === "mock") {
    return limited.map((item) => ({
      mimeType: item.mimeType,
      assetId: item.assetId,
      characterId: item.characterId,
    }));
  }
  const images = [];
  for (const item of limited) {
    const row = await getAssetRow(env, projectId, item.characterId, item.assetId);
    if (!row) continue;
    const object = await mediaOf(env).get(row.r2_key);
    if (!object) continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    images.push({
      mimeType: row.mime_type,
      data: bufferToBase64(bytes),
      assetId: item.assetId,
      characterId: item.characterId,
    });
  }
  return images;
}

export async function characterReferenceRoutes(request, env) {
  try {
    const url = new URL(request.url);
    const matched = matchPath(url.pathname);
    if (!matched) return null;
    assertScope(matched.projectId, matched.characterId, env);
    const { projectId, characterId } = matched;

    if (matched.lock) {
      if (request.method === "GET") return await handleGetLock(env, projectId, characterId);
      if (request.method === "POST") return await handleRebuildLock(env, projectId, characterId);
      fail("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
    }

    if (matched.selection) {
      if (request.method === "POST") return await handleSelection(request, env, projectId, characterId);
      fail("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
    }

    if (matched.assetId && matched.asset) {
      if (request.method !== "GET") fail("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
      const row = await getAssetRow(env, projectId, characterId, matched.assetId);
      if (!row) fail("NOT_FOUND", "Reference image not found.", 404);
      return await handleAsset(request, env, row);
    }

    if (matched.assetId) {
      if (request.method === "GET") {
        const row = await getAssetRow(env, projectId, characterId, matched.assetId);
        if (!row) fail("NOT_FOUND", "Reference image not found.", 404);
        return json({ reference: publicAsset(row, projectId) });
      }
      if (request.method === "PATCH") {
        const body = await request.json();
        const updated = await applyPatch(env, projectId, characterId, matched.assetId, patchFromBody(body));
        return json({
          reference: publicAsset(updated, projectId),
          coverage: evaluateReferenceCoverage(await listAssets(env, projectId, characterId)),
        });
      }
      if (request.method === "DELETE") return await handleDelete(env, projectId, characterId, matched.assetId);
      fail("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
    }

    if (request.method === "GET") {
      const assets = await listAssets(env, projectId, characterId);
      const state = await lockState(env, projectId, characterId, assets);
      return json({
        references: assets,
        coverage: state.coverage,
        lock: state.lock,
      });
    }
    if (request.method === "POST") return await handleUpload(request, env, projectId, characterId);
    if (request.method === "PATCH") {
      const body = await request.json();
      if (Array.isArray(body.orderedIds)) {
        const references = await handleReorder(env, projectId, characterId, body.orderedIds);
        return json({ references, coverage: evaluateReferenceCoverage(references) });
      }
      const ids = Array.isArray(body.ids) ? body.ids : [];
      if (!ids.length) fail("INVALID_INPUT", "ids or orderedIds are required.");
      const patch = patchFromBody(body.patch || body);
      for (const id of ids) await applyPatch(env, projectId, characterId, id, patch);
      const references = await listAssets(env, projectId, characterId);
      return json({ references, coverage: evaluateReferenceCoverage(references) });
    }
    fail("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  } catch (error) {
    const status = error instanceof ProviderError ? error.httpStatus : 500;
    return json(
      {
        error: {
          code: error.code || "REFERENCE_ERROR",
          message: error instanceof ProviderError ? error.message : "Character reference storage error.",
        },
      },
      status || 500,
    );
  }
}
