const DEFAULT_ADAPTER_URL = "https://fpai-film-studio-video-adapter.tjfalkahn.workers.dev";

function proxyHeaders(request, env) {
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${env.FPAI_CONTROL_TOKEN}`);
  headers.delete("host");
  return headers;
}

async function proxyApi(request, env) {
  if (!env.FPAI_CONTROL_TOKEN) {
    return new Response(JSON.stringify({ error: "FPAI_CONTROL_TOKEN is not configured on the frontend Worker." }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const source = new URL(request.url);
  const targetBase = String(env.VIDEO_ADAPTER_URL || DEFAULT_ADAPTER_URL).replace(/\/$/, "");
  const target = new URL(`${targetBase}${source.pathname}${source.search}`);
  const init = {
    method: request.method,
    headers: proxyHeaders(request, env),
    redirect: "manual",
  };

  if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;

  const response = await fetch(target, init);
  const headers = new Headers(response.headers);
  headers.delete("access-control-allow-origin");
  headers.delete("access-control-allow-credentials");
  headers.delete("vary");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
      return proxyApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
