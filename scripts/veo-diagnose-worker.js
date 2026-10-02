/**
 * Temporary service-binding caller for read-only Veo operation diagnostics.
 * Deployed only by CI; deleted after the run. Does not hold GEMINI_API_KEY.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const gate = String(env.DIAGNOSE_RUN_TOKEN || "");
    const provided = url.searchParams.get("token") || request.headers.get("x-fpai-diagnose-token") || "";
    if (!gate || provided !== gate) {
      return Response.json({ error: "Unauthorized diagnose caller." }, { status: 401 });
    }
    if (!env.ADAPTER || typeof env.ADAPTER.fetch !== "function") {
      return Response.json({ error: "ADAPTER service binding is missing." }, { status: 503 });
    }

    const operation = url.searchParams.get("operation") || "";
    const jobId = url.searchParams.get("jobId") || "";
    const target = new URL("https://adapter/api/diagnostics/veo-operation");
    if (operation) target.searchParams.set("operation", operation);
    if (jobId) target.searchParams.set("jobId", jobId);

    const response = await env.ADAPTER.fetch(
      new Request(target.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
      }),
    );
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  },
};
