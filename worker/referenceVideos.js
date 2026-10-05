import { fail } from "./providers/contract.js";
import { REFERENCE_VIDEO_MAX_SECONDS } from "../src/referenceVideoClient.js";

export const REFERENCE_VIDEO_MAX_BYTES = 32 * 1024 * 1024;
const ASSET_ID = /^[a-f0-9-]{36}$/i;
const encoder = new TextEncoder();
const DEFAULT_ORIGIN = "https://fpai-film-studio-video-adapter.tjfalkahn.workers.dev";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function err(error) {
  return {
    code: error.code || "INVALID_INPUT",
    message: error.message || "Reference video request failed.",
  };
}

function mediaOf(env) {
  if (!env?.GENERATION_MEDIA || typeof env.GENERATION_MEDIA.put !== "function") {
    fail("PROVIDER_CONFIG", "Render storage is not configured.", 503);
  }
  return env.GENERATION_MEDIA;
}

async function signingKey(secret) {
  if (!secret) throw new Error("Render input signing is not configured.");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function signatureBytes(value) {
  if (!/^[a-f0-9]{64}$/.test(value || "")) return null;
  return Uint8Array.from(value.match(/../g), (part) => parseInt(part, 16));
}

function hexSignature(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function adapterOrigin(env) {
  const origin = new URL(env.HIGGSFIELD_INPUT_ORIGIN || env.VIDEO_ADAPTER_URL || DEFAULT_ORIGIN);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new Error("Reference video origin must be an HTTPS origin.");
  }
  return origin;
}

export function isMp4(bytes) {
  return (
    bytes instanceof Uint8Array &&
    bytes.byteLength >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

export function objectKey(id) {
  return `reference-videos/${id}.mp4`;
}

export function validateReferenceVideo({ bytes, mimeType, duration } = {}) {
  const mime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (mime !== "video/mp4") {
    return { ok: false, errors: ["Upload an MP4 reference video."] };
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) {
    return { ok: false, errors: ["The MP4 file is empty or unreadable."] };
  }
  if (bytes.byteLength > REFERENCE_VIDEO_MAX_BYTES) {
    return { ok: false, errors: ["Reference videos must be 32 MB or smaller."] };
  }
  if (!isMp4(bytes)) {
    return { ok: false, errors: ["File bytes are not a valid MP4."] };
  }
  if (duration != null && duration !== "") {
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > REFERENCE_VIDEO_MAX_SECONDS) {
      return { ok: false, errors: ["Reference videos must be 30 seconds or shorter. Trim the clip before uploading."] };
    }
  }
  return { ok: true, mimeType: "video/mp4" };
}

export async function signedReferenceVideoUrl(env, assetId, now = Date.now()) {
  if (!ASSET_ID.test(assetId || "")) throw new Error("Reference video ID required for signed playback.");
  const expires = Math.floor(now / 1000) + 3600;
  const signedValue = `${assetId}:${expires}:video`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(env.FPAI_CONTROL_TOKEN),
    encoder.encode(signedValue),
  );
  const url = new URL(`/api/reference-videos/${assetId}`, adapterOrigin(env));
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", hexSignature(signature));
  return url.href;
}

async function readObject(env, id) {
  const object = await mediaOf(env).get(objectKey(id));
  if (!object) return null;
  return object;
}

function videoResponse(object, method) {
  const headers = new Headers({
    "content-type": object.httpMetadata?.contentType || "video/mp4",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  if (object.size != null) headers.set("content-length", String(object.size));
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}

export async function serveSignedReferenceVideo(request, env, now = Date.now()) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/reference-videos\/([a-f0-9-]{36})$/i);
  if (!match || !["GET", "HEAD"].includes(request.method)) return null;
  if (!url.searchParams.has("signature")) return null;
  const expires = url.searchParams.get("expires");
  const bytes = signatureBytes(url.searchParams.get("signature"));
  if (
    !/^\d{10}$/.test(expires || "") ||
    !bytes ||
    Number(expires) <= Math.floor(now / 1000) ||
    Number(expires) > Math.floor(now / 1000) + 3600
  ) {
    return new Response("Unavailable", { status: 404 });
  }
  const signedValue = `${match[1]}:${expires}:video`;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(env.FPAI_CONTROL_TOKEN),
    bytes,
    encoder.encode(signedValue),
  );
  if (!valid) return new Response("Unavailable", { status: 404 });
  const object = await env.GENERATION_MEDIA?.get(objectKey(match[1]));
  if (!object) return new Response("Unavailable", { status: 404 });
  return videoResponse(object, request.method);
}

async function handleUpload(request, env) {
  mediaOf(env);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    fail("INVALID_INPUT", "multipart/form-data is required for reference video uploads.", 415);
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    fail("INVALID_INPUT", "An MP4 file is required.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateReferenceVideo({
    bytes,
    mimeType: file.type || form.get("mimeType"),
    duration: form.get("duration"),
  });
  if (!validated.ok) fail("INVALID_FILE", validated.errors[0], 400);

  const id = crypto.randomUUID();
  const durationValue = form.get("duration");
  const duration = durationValue == null || durationValue === "" ? null : Number(durationValue);
  await env.GENERATION_MEDIA.put(objectKey(id), bytes, {
    httpMetadata: { contentType: "video/mp4" },
    customMetadata: {
      duration: duration == null ? "" : String(duration),
      filename: String(file.name || "reference.mp4").slice(0, 200),
    },
  });
  return json({
    id,
    mimeType: "video/mp4",
    size: bytes.byteLength,
    duration,
    url: `/api/reference-videos/${id}`,
    generationStarted: false,
  }, 201);
}

async function handleGet(request, env, id) {
  const object = await readObject(env, id);
  if (!object) fail("NOT_FOUND", "Reference video not found.", 404);
  return videoResponse(object, request.method);
}

export async function referenceVideoExists(env, assetId) {
  if (!ASSET_ID.test(assetId || "") || !env?.GENERATION_MEDIA?.get) return false;
  return Boolean(await env.GENERATION_MEDIA.get(objectKey(assetId)));
}

export async function referenceVideoRoutes(request, env) {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/api/reference-videos" && request.method === "POST") {
      return await handleUpload(request, env);
    }
    const match = url.pathname.match(/^\/api\/reference-videos\/([a-f0-9-]{36})$/i);
    if (match && (request.method === "GET" || request.method === "HEAD")) {
      return await handleGet(request, env, match[1]);
    }
    return null;
  } catch (error) {
    return json({ error: err(error) }, error.httpStatus || 400);
  }
}
