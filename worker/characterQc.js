import { ProviderError } from "./providers/contract.js";

function fail(code, message, httpStatus = 500, extra = {}) {
  throw new ProviderError(code, message, { httpStatus, ...extra });
}

function clamp(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function encodeBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function model(env) {
  return String(env.CHARACTER_QC_MODEL || "gemini-2.5-flash").trim();
}

function endpoint(env) {
  if (!env.GEMINI_API_KEY) fail("QC_CONFIG", "GEMINI_API_KEY is required for character QC.", 503);
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model(env))}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
}

function rubric({ job, plan }) {
  const profile = plan.character || {};
  return [
    "You are the visual quality-control judge for an automated film character factory.",
    "Evaluate only what is visible. Do not reward artistic appeal if identity or anatomy drifted.",
    "Return strict JSON only with keys identity, anatomy, framing, wardrobe, artifactFree, notes.",
    "Every score must be a number from 0.0 to 1.0.",
    "identity: same person and stable apparent age, face, skin tone, hairline, body proportions, and height impression.",
    "anatomy: natural body/face/hands with no malformed or duplicated features.",
    "framing: requested angle/crop/pose is actually satisfied.",
    "wardrobe: requested clothing and protected wardrobe details are correct.",
    "artifactFree: no text, watermark, collage, duplicate person, broken background, or obvious generation artifact.",
    `Character: ${profile.name || profile.id || "unknown"}.`,
    profile.height ? `Required height impression: ${profile.height}.` : "",
    profile.build ? `Required build: ${profile.build}.` : "",
    profile.protectedTraits?.length ? `Must preserve: ${profile.protectedTraits.join(", ")}.` : "",
    profile.negativeTraits?.length ? `Must avoid: ${profile.negativeTraits.join(", ")}.` : "",
    job.label ? `Requested task: ${job.label}.` : "",
    job.wardrobe ? `Requested wardrobe: ${job.wardrobe}.` : "",
    `Generation prompt: ${job.prompt}`,
    "Be conservative. If evidence is ambiguous, lower the score rather than guessing.",
  ].filter(Boolean).join("\n");
}

function extractJson(payload) {
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim();
  if (!text) fail("QC_INVALID_RESPONSE", "Character QC returned no text.", 502);
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); }
  catch { fail("QC_INVALID_RESPONSE", "Character QC returned malformed JSON.", 502); }
}

export function createGeminiCharacterEvaluator(env = {}, fetchImpl = fetch) {
  return async function evaluateImage({ bytes, mimeType = "image/png", job, plan }) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) fail("QC_INPUT", "Character QC image bytes are required.", 400);
    if (!/^image\/(png|jpeg|webp)$/i.test(mimeType)) fail("QC_INPUT", "Character QC supports PNG, JPEG, or WebP.", 400);
    const response = await fetchImpl(endpoint(env), {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(Number(env.CHARACTER_QC_TIMEOUT_MS || 30000)),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: rubric({ job, plan }) },
          { inlineData: { mimeType, data: encodeBase64(bytes) } },
        ] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!response.ok) {
      const body = await response.clone().json().catch(() => null);
      fail("QC_HTTP", body?.error?.message || `Character QC returned HTTP ${response.status}.`, response.status === 429 ? 429 : 502, { retryable: response.status === 429 || response.status >= 500 });
    }
    const parsed = extractJson(await response.json());
    return {
      metrics: {
        identity: clamp(parsed.identity),
        anatomy: clamp(parsed.anatomy),
        framing: clamp(parsed.framing),
        wardrobe: clamp(parsed.wardrobe),
        artifactFree: clamp(parsed.artifactFree),
      },
      notes: String(parsed.notes || "").slice(0, 1000),
      evaluator: { provider: "gemini", model: model(env) },
    };
  };
}
