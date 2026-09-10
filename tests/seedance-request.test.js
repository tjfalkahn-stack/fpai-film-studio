import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEEDANCE_ENDPOINTS,
  buildSeedanceRequest,
  collectSeedanceMedia,
  isSeedanceProvider,
  selectSeedanceMode,
  seedanceEndpointId,
  seedanceTier,
} from "../src/seedanceRequest.js";
import {
  DEFAULT_SEEDANCE_RATES,
  estimateSeedanceCost,
} from "../src/seedancePricing.js";

const png = { mimeType: "image/png", data: "iVBORw0KGgo=" };

test("Fast vs Standard endpoint mapping for text, image, and reference modes", () => {
  assert.equal(
    seedanceEndpointId("fast", "text-to-video"),
    "bytedance/seedance-2.0/fast/text-to-video",
  );
  assert.equal(
    seedanceEndpointId("fast", "image-to-video"),
    "bytedance/seedance-2.0/fast/image-to-video",
  );
  assert.equal(
    seedanceEndpointId("fast", "reference-to-video"),
    "bytedance/seedance-2.0/fast/reference-to-video",
  );
  assert.equal(
    seedanceEndpointId("standard", "text-to-video"),
    "bytedance/seedance-2.0/text-to-video",
  );
  assert.equal(
    seedanceEndpointId("standard", "image-to-video"),
    "bytedance/seedance-2.0/image-to-video",
  );
  assert.equal(
    seedanceEndpointId("standard", "reference-to-video"),
    "bytedance/seedance-2.0/reference-to-video",
  );
  assert.equal(SEEDANCE_ENDPOINTS.fast["text-to-video"].includes("/fast/"), true);
  assert.equal(SEEDANCE_ENDPOINTS.standard["text-to-video"].includes("/fast/"), false);
  assert.equal(seedanceTier("seedance-fast"), "fast");
  assert.equal(seedanceTier("seedance-standard"), "standard");
  assert.equal(isSeedanceProvider("seedance-fast"), true);
  assert.equal(isSeedanceProvider("veo-fast"), false);
});

test("text-to-video request construction", () => {
  const built = buildSeedanceRequest({
    provider: "seedance-fast",
    prompt: "Rain on an empty runway",
    duration: 5,
    resolution: "720p",
    aspectRatio: "16:9",
    generateAudio: false,
    seed: 42,
    projectId: "enemies-closer-ep01",
  });
  assert.equal(built.mode, "text-to-video");
  assert.equal(built.endpointId, "bytedance/seedance-2.0/fast/text-to-video");
  assert.equal(built.body.prompt, "Rain on an empty runway");
  assert.equal(built.body.duration, "5");
  assert.equal(built.body.resolution, "720p");
  assert.equal(built.body.aspect_ratio, "16:9");
  assert.equal(built.body.generate_audio, false);
  assert.equal(built.body.seed, 42);
  assert.equal(built.body.image_url, undefined);
  assert.equal(built.body.image_urls, undefined);
});

test("image-to-video uses start frame and optional end frame", () => {
  const built = buildSeedanceRequest({
    provider: "seedance-standard",
    prompt: "Jasmine steps forward",
    duration: 6,
    resolution: "1080p",
    aspectRatio: "16:9",
    referenceImages: [{ ...png, characterId: "jasmine", role: "character" }],
    endFrameImage: { ...png, role: "end-frame" },
  });
  assert.equal(built.mode, "image-to-video");
  assert.equal(built.endpointId, "bytedance/seedance-2.0/image-to-video");
  assert.match(built.body.image_url, /^data:image\/png;base64,/);
  assert.match(built.body.end_image_url, /^data:image\/png;base64,/);
  assert.match(built.body.prompt, /@Image1 is Jasmine/);
});

test("reference-to-video maps multiple Character Bible images and scene refs", () => {
  const built = buildSeedanceRequest({
    provider: "seedance-fast",
    prompt: "Jasmine moving with young Mikey through a tense nighttime tarmac",
    duration: 6,
    resolution: "720p",
    aspectRatio: "16:9",
    referenceImages: [
      { ...png, characterId: "jasmine", role: "character", category: "identity-front" },
      { ...png, characterId: "mikey", role: "character", category: "identity-front" },
    ],
    environmentReferences: [{ ...png, role: "environment", name: "Tarmac Master 01" }],
  });
  assert.equal(selectSeedanceMode(collectSeedanceMedia({
    referenceImages: built.media.images,
  })), "reference-to-video");
  assert.equal(built.mode, "reference-to-video");
  assert.equal(built.endpointId, "bytedance/seedance-2.0/fast/reference-to-video");
  assert.equal(built.body.image_urls.length, 3);
  assert.match(built.body.prompt, /@Image1 is Jasmine/);
  assert.match(built.body.prompt, /@Image2 is Mikey/);
  assert.match(built.body.prompt, /@Image3 is Tarmac Master 01/);
  assert.equal(built.referenceCount, 3);
  assert.equal(built.audio, true);
});

test("reference video selects reference-to-video and optional lower pricing", () => {
  const built = buildSeedanceRequest(
    {
      provider: "seedance-standard",
      prompt: "Follow the existing staging",
      duration: 8,
      resolution: "720p",
      aspectRatio: "16:9",
      referenceImages: [{ ...png, characterId: "marcus" }],
      referenceVideos: [{ url: "https://v3b.fal.media/files/example.mp4", label: "blocking take" }],
    },
    { SEEDANCE_STANDARD_REFERENCE_VIDEO_720P_PER_SECOND_USD: "0.20" },
  );
  assert.equal(built.mode, "reference-to-video");
  assert.deepEqual(built.body.video_urls, ["https://v3b.fal.media/files/example.mp4"]);
  assert.equal(built.quote.ratePerSecond, 0.2);
  assert.equal(built.quote.estimatedCost, 1.6);
});

test("cost estimation uses configurable Seedance defaults before submission", () => {
  const fast = estimateSeedanceCost({
    provider: "seedance-fast",
    duration: 6,
    resolution: "720p",
  });
  assert.equal(fast.ratePerSecond, DEFAULT_SEEDANCE_RATES["fast-720p"]);
  assert.equal(fast.estimatedCost, 1.4514);

  const standard = estimateSeedanceCost({
    provider: "seedance-standard",
    duration: 6,
    resolution: "720p",
  });
  assert.equal(standard.estimatedCost, 1.8144);

  const hd = estimateSeedanceCost({
    provider: "seedance-standard",
    duration: 15,
    resolution: "1080p",
  });
  assert.equal(hd.estimatedCost, 10.23);

  const override = estimateSeedanceCost(
    { provider: "seedance-fast", duration: 4, resolution: "720p" },
    { SEEDANCE_FAST_720P_PER_SECOND_USD: "0.10" },
  );
  assert.equal(override.estimatedCost, 0.4);
});
