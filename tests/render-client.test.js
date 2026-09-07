import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { renderIdentity, renderRequestKey } from "../src/renderClient.js";

const httpCrypto = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
const input = { provider: "mock", prompt: "Marcus hero reveal", duration: 8,
  referenceImages: [{ mimeType: "image/png", data: "private-reference-bytes" }] };

test("HTTP preview can identify/retry mock inputs without SubtleCrypto or storing reference bytes", async () => {
  const identity = await renderIdentity(input, httpCrypto);
  assert.equal(identity, await renderIdentity(structuredClone(input), httpCrypto));
  assert.notEqual(identity, await renderIdentity({ ...input, prompt: "Another take" }, httpCrypto));
  assert.notEqual(identity, await renderIdentity({ ...input, referenceImages: [] }, httpCrypto));
  assert.ok(identity.length < 100);
  assert.ok(!identity.includes("private-reference-bytes"));
});

test("HTTP preview request keys use secure randomness without randomUUID", () => {
  const keys = new Set(Array.from({ length: 100 }, () => renderRequestKey(httpCrypto)));
  assert.equal(keys.size, 100);
  for (const key of keys) assert.match(key, /^[a-f0-9]{32}$/);
  assert.throws(() => renderRequestKey({}), /secure render request ID/);
});

test("secure browser identities retain the original SHA-256 format for pending retries", async () => {
  assert.equal(await renderIdentity(input, webcrypto),
    createHash("sha256").update(JSON.stringify(input)).digest("hex"));
});

test("HTTP preview fallback cannot submit a paid or unknown renderer", async () => {
  for (const provider of ["veo-fast", "unknown", undefined])
    await assert.rejects(renderIdentity({ ...input, provider }, httpCrypto), /HTTPS/);
});
