import { authorizeStudio } from "./auth.js";
const DEFAULT_ADAPTER_URL = "https://fpai-film-studio-video-adapter.tjfalkahn.workers.dev";

const PROXY_HEADER_ALLOWLIST = ["content-type", "accept", "range", "if-range", "x-fpai-owner-override"];
const STRIP_RESPONSE_HEADERS = [
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-max-age",
  "vary",
];

export function isProxyPath(pathname) {
  const path = String(pathname || "");
  return path === "/health" || path === "/health/" || path === "/api" || path.startsWith("/api/");
}

export function adapterOrigin(env = {}) {
  return String(env.VIDEO_ADAPTER_URL || DEFAULT_ADAPTER_URL).replace(/\/+$/, "");
}

export function buildAdapterTarget(env, sourceUrl) {
  const source = sourceUrl instanceof URL ? sourceUrl : new URL(sourceUrl);
  return `${adapterOrigin(env)}${source.pathname}${source.search}`;
}

export function buildProxyHeaders(request, token) {
  const headers = new Headers();
  for (const name of PROXY_HEADER_ALLOWLIST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("accept")) headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  return headers;
}

export function sanitizeProxyResponseHeaders(headers) {
  const next = new Headers(headers);
  for (const name of STRIP_RESPONSE_HEADERS) next.delete(name);
  next.delete("authorization");
  next.delete("set-cookie");
  return next;
}

export function hasServiceBinding(env = {}) {
  return Boolean(env.VIDEO_ADAPTER && typeof env.VIDEO_ADAPTER.fetch === "function");
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function logProxy(event, details) {
  const safe = { ...details };
  delete safe.authorization;
  delete safe.token;
  delete safe.headers;
  console.log(`fpai-proxy ${event} ${JSON.stringify(safe)}`);
}

function looksLikeCloudflareHtml404(response) {
  const contentType = response.headers.get("content-type") || "";
  return response.status === 404 && contentType.includes("text/html");
}

export function createProxyRequest(request, env) {
  const target = buildAdapterTarget(env, request.url);
  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const init = {
    method,
    headers: buildProxyHeaders(request, env.FPAI_CONTROL_TOKEN),
    redirect: "manual",
  };
  if (hasBody) {
    init.body = request.body;
    init.duplex = "half";
  }
  return { target, proxyRequest: new Request(target, init) };
}

async function proxyToAdapter(request, env) {
  if (!env.FPAI_CONTROL_TOKEN) {
    logProxy("error", { reason: "missing-frontend-control-token" });
    return jsonResponse({ error: "FPAI_CONTROL_TOKEN is not configured on the frontend Worker." }, 503);
  }

  const via = hasServiceBinding(env) ? "service-binding" : "http";
  const { target, proxyRequest } = createProxyRequest(request, env);

  logProxy("request", {
    method: request.method,
    sourcePath: new URL(request.url).pathname,
    target,
    via,
    tokenConfigured: true,
  });

  try {
    const fetcher = via === "service-binding" ? env.VIDEO_ADAPTER : globalThis;
    const response = await fetcher.fetch(proxyRequest);
    logProxy("response", {
      target,
      via,
      status: response.status,
      contentType: response.headers.get("content-type"),
    });

    if (looksLikeCloudflareHtml404(response)) {
      logProxy("error", {
        target,
        via,
        status: response.status,
        reason: "adapter-html-404",
      });
      return jsonResponse({
        error: "Video adapter proxy received HTML 404 instead of JSON. Same-zone workers.dev fetch cannot reach the adapter; deploy with the VIDEO_ADAPTER service binding.",
        target,
        via,
      }, 502);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: sanitizeProxyResponseHeaders(response.headers),
    });
  } catch (error) {
    logProxy("error", {
      target,
      via,
      reason: "proxy-fetch-failed",
      message: String(error?.message || error),
    });
    return jsonResponse({
      error: "Video adapter proxy failed.",
      target,
      via,
    }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/health" && !await authorizeStudio(request, env)) return jsonResponse({ error: "Sign in through the configured Cloudflare Access application." }, 401);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.get("origin") && request.headers.get("origin") !== url.origin) return jsonResponse({ error: "Cross-origin writes are blocked." }, 403);

    if (isProxyPath(url.pathname)) {
      return proxyToAdapter(request, env);
    }

    if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
      return jsonResponse({ error: "Frontend assets binding is not configured." }, 500);
    }

    return env.ASSETS.fetch(request);
  },
};
