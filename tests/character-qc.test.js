import { test } from "node:test";
import assert from "node:assert/strict";
import { createGeminiCharacterEvaluator } from "../worker/characterQc.js";

const plan = { character: { id: "marcus", name: "Marcus", height: "6'2\"", build: "tall lean athletic", protectedTraits: ["tall proportions"] } };
const job = { id: "marcus/angles/front", label: "Identity Front", wardrobe: "black tactical look", prompt: "Marcus front portrait" };

test("Gemini QC normalizes strict metric JSON", async () => {
  let request;
  const evaluate = createGeminiCharacterEvaluator({ GEMINI_API_KEY: "test-key", CHARACTER_QC_MODEL: "gemini-test" }, async (url, init) => {
    request = { url: String(url), init };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ identity: 0.93, anatomy: 0.88, framing: 0.9, wardrobe: 0.86, artifactFree: 0.97, notes: "pass" }) }] } }] });
  });
  const out = await evaluate({ bytes: new Uint8Array([1,2,3]), mimeType: "image/png", job, plan });
  assert.equal(out.metrics.identity, 0.93);
  assert.equal(out.metrics.artifactFree, 0.97);
  assert.equal(out.evaluator.model, "gemini-test");
  assert.match(request.url, /gemini-test:generateContent/);
  const body = JSON.parse(request.init.body);
  assert.match(body.contents[0].parts[0].text, /6'2/);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
});

test("Gemini QC clamps out-of-range scores", async () => {
  const evaluate = createGeminiCharacterEvaluator({ GEMINI_API_KEY: "test-key" }, async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"identity":2,"anatomy":-1,"framing":0.5,"wardrobe":0.5,"artifactFree":0.5}' }] } }] }));
  const out = await evaluate({ bytes: new Uint8Array([1]), mimeType: "image/jpeg", job, plan });
  assert.equal(out.metrics.identity, 1);
  assert.equal(out.metrics.anatomy, 0);
});
