import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker, {
  adapterOrigin,
  buildAdapterTarget,
  buildProxyHeaders,
  createProxyRequest,
  hasServiceBinding,
  isProxyPath,
  sanitizeProxyResponseHeaders,
} from "./index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "frontend-control-token";
const ADAPTER_URL = "https://fpai-film-studio-video-adapter.tjfalkahn.workers.dev";

function request(path, init = {}) {
  return new Request(`https://fpai-film-studio.tjfalkahn.workers.dev${path}`, init);
}

test("proxies health and api paths only", () => {
  assert.equal(isProxyPath("/health"), true);
  assert.equal(isProxyPath("/health/"), true);
  assert.equal(isProxyPath("/api/generation-jobs"), true);
  assert.equal(isProxyPath("/api/generation-jobs/abc/media"), true);
  assert.equal(isProxyPath("/"), false);
  assert.equal(isProxyPath("/index.html"), false);
  assert.equal(isProxyPath("/assets/index.js"), false);
});

test("builds the adapter target from the incoming path", () => {
  assert.equal(adapterOrigin({}), ADAPTER_URL);
  assert.equal(
    buildAdapterTarget({ VIDEO_ADAPTER_URL: `${ADAPTER_URL}/` }, "https://studio.example/health?ready=1"),
    `${ADAPTER_URL}/health?ready=1`,
  );
});

test("injects the server token and never forwards a browser Authorization header", () => {
  const headers = buildProxyHeaders(request("/api/generation-jobs", {
    headers: {
      authorization: "Bearer browser-token",
      "content-type": "application/json",
      "x-fpai-owner-override": "confirm",
      cookie: "session=browser-secret",
    },
  }), TOKEN);
  assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("x-fpai-owner-override"), "confirm");
  assert.equal(headers.get("cookie"), null);
});

test("createProxyRequest uses a new URL and does not leak the token into the URL", () => {
  const { target, proxyRequest } = createProxyRequest(request("/health"), {
    FPAI_CONTROL_TOKEN: TOKEN,
    VIDEO_ADAPTER_URL: ADAPTER_URL,
  });
  assert.equal(target, `${ADAPTER_URL}/health`);
  assert.equal(proxyRequest.url, `${ADAPTER_URL}/health`);
  assert.equal(proxyRequest.headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(target.includes(TOKEN), false);
});

test("GET /health is proxied through the VIDEO_ADAPTER service binding", async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(String(message));
  const adapterBody = {
    ok: true,
    adapter: "fpai-google-video-v1",
    liveExecutionReady: true,
  };
  let captured;
  const env = {
    FPAI_CONTROL_TOKEN: TOKEN,
    VIDEO_ADAPTER_URL: ADAPTER_URL,
    VIDEO_ADAPTER: {
      async fetch(req) {
        captured = req;
        return new Response(JSON.stringify(adapterBody), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "https://evil.example",
          },
        });
      },
    },
    ASSETS: {
      fetch: async () => new Response("assets-should-not-run", { status: 500 }),
    },
  };

  try {
    const response = await worker.fetch(request("/health"), env);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.liveExecutionReady, true);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(captured.url, `${ADAPTER_URL}/health`);
    assert.equal(captured.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(JSON.stringify(payload).includes(TOKEN), false);
    assert.equal(logs.some((line) => line.includes(TOKEN)), false);
    assert.equal(logs.some((line) => line.includes('"via":"service-binding"')), true);
    assert.equal(logs.some((line) => line.includes('"status":200')), true);
  } finally {
    console.log = originalLog;
  }
});

test("POST /api/* forwards the body and owner override through the service binding", async () => {
  let captured;
  const env = {
    FPAI_CONTROL_TOKEN: TOKEN,
    VIDEO_ADAPTER: {
      async fetch(req) {
        captured = {
          url: req.url,
          method: req.method,
          authorization: req.headers.get("authorization"),
          override: req.headers.get("x-fpai-owner-override"),
          body: await req.text(),
        };
        return new Response(JSON.stringify({ error: "Not found." }), {
          status: 404,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      },
    },
    ASSETS: { fetch: async () => new Response("nope", { status: 500 }) },
  };

  const response = await worker.fetch(request("/api/generation-jobs", {
    method: "POST",
    headers: { "content-type": "application/json", "x-fpai-owner-override": "confirm" },
    body: JSON.stringify({ ping: true }),
  }), env);

  assert.equal(response.status, 404);
  assert.equal(captured.method, "POST");
  assert.equal(captured.url, `${ADAPTER_URL}/api/generation-jobs`);
  assert.equal(captured.authorization, `Bearer ${TOKEN}`);
  assert.equal(captured.override, "confirm");
  assert.equal(captured.body, JSON.stringify({ ping: true }));
  const payload = await response.json();
  assert.equal(payload.error, "Not found.");
});

test("non-api routes stay on the SPA assets binding", async () => {
  const env = {
    FPAI_CONTROL_TOKEN: TOKEN,
    VIDEO_ADAPTER: { fetch: async () => new Response("adapter-should-not-run", { status: 500 }) },
    ASSETS: {
      fetch: async (req) => new Response(`asset:${new URL(req.url).pathname}`, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    },
  };
  const response = await worker.fetch(request("/shots"), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset:/shots");
});

test("same-zone HTML 404 is converted to JSON instead of being passed through", async () => {
  const env = {
    FPAI_CONTROL_TOKEN: TOKEN,
    ASSETS: { fetch: async () => new Response("nope", { status: 500 }) },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<!DOCTYPE html><title>Page not found</title>", {
    status: 404,
    headers: { "content-type": "text/html; charset=UTF-8" },
  });
  try {
    assert.equal(hasServiceBinding(env), false);
    const response = await worker.fetch(request("/health"), env);
    const payload = await response.json();
    assert.equal(response.status, 502);
    assert.match(payload.error, /service binding/i);
    assert.equal(payload.via, "http");
    assert.equal(response.headers.get("content-type").includes("application/json"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sanitized responses never include the control token", () => {
  const headers = sanitizeProxyResponseHeaders(new Headers({
    authorization: `Bearer ${TOKEN}`,
    "set-cookie": "token=secret",
    "content-type": "application/json",
  }));
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("set-cookie"), null);
  assert.equal(headers.get("content-type"), "application/json");
});

test("frontend wrangler config is worker-first and uses a service binding", () => {
  for (const file of ["wrangler.frontend.toml", "wrangler.frontend.example.toml"]) {
    const toml = readFileSync(join(root, file), "utf8");
    assert.match(toml, /main\s*=\s*"frontend-worker\/index\.js"/);
    assert.match(toml, /workers_dev\s*=\s*true/);
    assert.match(toml, /run_worker_first\s*=\s*true/);
    assert.match(toml, /binding\s*=\s*"ASSETS"/);
    assert.match(toml, /not_found_handling\s*=\s*"single-page-application"/);
    assert.match(toml, /\[\[services\]\]/);
    assert.match(toml, /binding\s*=\s*"VIDEO_ADAPTER"/);
    assert.match(toml, /service\s*=\s*"fpai-film-studio-video-adapter"/);
    assert.equal(toml.includes(TOKEN), false);
    assert.equal(/FPAI_CONTROL_TOKEN\s*=/.test(toml), false);
  }
});
