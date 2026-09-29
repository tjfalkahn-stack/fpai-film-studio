const DEFAULT_ORIGIN = "https://fpai-film-studio-video-adapter.tjfalkahn.workers.dev";
const encoder = new TextEncoder();

async function signingKey(secret) {
  if (!secret) throw new Error("Render input signing is not configured.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function signatureBytes(value) {
  if (!/^[a-f0-9]{64}$/.test(value || "")) return null;
  return Uint8Array.from(value.match(/../g), part => parseInt(part, 16));
}

export async function signedHiggsfieldInputUrl(env, renderId, now = Date.now(), frame = "start") {
  if (!/^[a-f0-9-]{36}$/i.test(renderId || "")) throw new Error("Render ID required for signed image input.");
  if (!["start", "end"].includes(frame)) throw new Error("Invalid image frame.");
  const expires = Math.floor(now / 1000) + 3600;
  const signedValue = `${renderId}:${expires}${frame === "end" ? ":end" : ""}`;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(env.FPAI_CONTROL_TOKEN), encoder.encode(signedValue));
  const origin = new URL(env.HIGGSFIELD_INPUT_ORIGIN || DEFAULT_ORIGIN);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/")
    throw new Error("Higgsfield image input origin must be an HTTPS origin.");
  const url = new URL(`/api/renders/${renderId}/input`, origin);
  url.searchParams.set("expires", String(expires));
  if (frame === "end") url.searchParams.set("frame", "end");
  url.searchParams.set("signature", Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join(""));
  return url.href;
}

export async function serveHiggsfieldInput(request, env, now = Date.now()) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/renders\/([a-f0-9-]{36})\/input$/i);
  if (!match || request.method !== "GET") return null;
  const expires = url.searchParams.get("expires");
  const frame = url.searchParams.get("frame") || "start";
  if (!["start", "end"].includes(frame)) return new Response("Unavailable", { status: 404 });
  const bytes = signatureBytes(url.searchParams.get("signature"));
  if (!/^\d{10}$/.test(expires || "") || !bytes || Number(expires) <= Math.floor(now / 1000) || Number(expires) > Math.floor(now / 1000) + 3600)
    return new Response("Unavailable", { status: 404 });
  const signedValue = `${match[1]}:${expires}${frame === "end" ? ":end" : ""}`;
  const valid = await crypto.subtle.verify("HMAC", await signingKey(env.FPAI_CONTROL_TOKEN), bytes, encoder.encode(signedValue));
  if (!valid) return new Response("Unavailable", { status: 404 });
  const stored = await env.GENERATION_MEDIA?.get(`render-inputs/${match[1]}.json`);
  if (!stored) return new Response("Unavailable", { status: 404 });
  const input = await stored.json();
  const ref = frame === "end" ? input.endFrameImage : input.referenceImages?.[0];
  if (!ref || !["image/jpeg", "image/png"].includes(ref.mimeType) || typeof ref.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(ref.data))
    return new Response("Unavailable", { status: 404 });
  return new Response(Uint8Array.from(atob(ref.data), char => char.charCodeAt(0)), {
    headers: { "content-type": ref.mimeType, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}
