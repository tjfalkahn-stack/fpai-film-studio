import { test } from "node:test";
import assert from "node:assert/strict";
import { createSyncLipsyncProvider, wavDuration } from "../worker/providers/syncLipsync.js";
import { renderReferenceKeys } from "../src/shotStartFrame.js";

function wav(seconds = 6) {
  const rate = 24000, size = rate * seconds * 2;
  const bytes = Buffer.alloc(44 + size);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + size, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(size, 40);
  return { mimeType: "audio/wav", data: bytes.toString("base64") };
}

const image = { mimeType: "image/jpeg", data: "/9j/2Q==" };
const input = () => ({ duration: 6, resolution: "720p", aspectRatio: "9:16", referenceImages: [image], audioInput: wav() });

test("the spokesperson route quotes only valid six-second WAV and the approved start frame", () => {
  const provider = createSyncLipsyncProvider({ SYNC3_RATE_PER_SECOND_USD: "0.1333" });
  assert.equal(wavDuration(wav()), 6);
  assert.equal(provider.estimate(input()).estimatedCost, 0.7998);
  assert.throws(() => provider.estimate({ ...input(), audioInput: undefined }), /WAV/);
  assert.throws(() => provider.estimate({ ...input(), audioInput: wav(4) }), /six seconds/);
  assert.deepEqual(renderReferenceKeys({ provider: "sync-lipsync-v3", startFrameKey: "portrait", selected: ["wrong"] }), ["portrait"]);
});

test("lip-sync submission sends the supplied image and audio to the queue once", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ request_id: "12345678" });
  };
  const provider = createSyncLipsyncProvider({
    SYNC3_RATE_PER_SECOND_USD: "0.1333", SYNC3_LIVE_ENABLED: "true", FAL_KEY: "test",
  }, fetchImpl);
  const started = await provider.start(input());
  assert.equal(started.operationId, "sync3:12345678");
  assert.equal(calls.length, 1);
  const submitted = JSON.parse(calls[0].init.body);
  assert.match(submitted.image_url, /^data:image\/jpeg;base64,/);
  assert.match(submitted.audio_url, /^data:audio\/wav;base64,/);
  assert.match(calls[0].url, /sync-lipsync\/v3\/image-to-video$/);
});
