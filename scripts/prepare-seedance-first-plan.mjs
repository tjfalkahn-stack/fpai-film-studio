import fs from "node:fs/promises";
import path from "node:path";
import { buildSeedanceRequest, CHARACTER_BIBLE } from "../src/seedanceRequest.js";
import { DEFAULT_SEEDANCE_RATES, SEEDANCE_PRICING_UPDATED_AT } from "../src/seedancePricing.js";
import { SEEDANCE_CONTROLLED_TEST } from "../src/seedanceControlledTest.js";

const outDir = "benchmarks";
const outFile = path.join(outDir, "enemies-closer.scene-001.seedance.plan.json");

const prompt =
  "CONTROL mode · Jasmine moving with young Mikey through a tense nighttime tarmac · Handheld coverage · final edit 6 seconds · identity drift STRICT · Use generated production sound only as reference audio. Night, heavy rain, private East Houston airfield. Jasmine keeps Mikey close as they move across wet tarmac under sparse sodium lights, rain hammering metal and pavement. Cinematic, grounded, no identity drift.";

const jasmine = {
  mimeType: "image/png",
  data: "iVBORw0KGgo=",
  characterId: "jasmine",
  role: "character",
  category: "identity-front",
  name: CHARACTER_BIBLE.jasmine.shortName,
};
const mikey = {
  mimeType: "image/png",
  data: "iVBORw0KGgo=",
  characterId: "mikey",
  role: "character",
  category: "identity-front",
  name: CHARACTER_BIBLE.mikey.shortName,
};
const tarmac = {
  mimeType: "image/png",
  data: "iVBORw0KGgo=",
  role: "environment",
  name: "Tarmac Master 01",
};

const input = {
  projectId: "enemies-closer-ep01",
  sceneId: "001",
  shotId: SEEDANCE_CONTROLLED_TEST.shotId,
  provider: "seedance-fast",
  tier: "fast",
  prompt,
  duration: 6,
  resolution: "720p",
  aspectRatio: "16:9",
  generateAudio: true,
  referenceImages: [jasmine, mikey],
  environmentReferences: [tarmac],
};

const built = buildSeedanceRequest(input);

const packet = {
  schema: "fpai.seedance.first-test.v1",
  execute: false,
  project: "Enemies Closer",
  projectId: "enemies-closer-ep01",
  scene: {
    id: "001",
    title: "Tarmac / Night / Rain",
    location: "Private airfield · East Houston",
    weather: "Heavy rain",
  },
  concept:
    "Jasmine moving with young Mikey through a tense nighttime tarmac environment, using Character Bible references plus a tarmac/environment reference.",
  characters: [
    { id: "jasmine", name: CHARACTER_BIBLE.jasmine.name, role: CHARACTER_BIBLE.jasmine.role },
    { id: "mikey", name: CHARACTER_BIBLE.mikey.name, role: CHARACTER_BIBLE.mikey.role },
  ],
  environmentReference: { id: "a1", name: "Tarmac Master 01", type: "Location" },
  liveFlagsRequired: {
    SEEDANCE_LIVE_ENABLED: "true",
  },
  liveFlagsMustStayFalse: {
    LIVE_RENDERING_ENABLED: "false",
    MOCK_E2E_VERIFIED: "false",
  },
  liveFlagsInThisRepo: {
    LIVE_RENDERING_ENABLED: "false",
    MOCK_E2E_VERIFIED: "false",
    SEEDANCE_LIVE_ENABLED: "false",
  },
  authorization: {
    seedanceLiveEnabled: true,
    liveRenderingEnabled: false,
    mockE2eVerified: "not-used-for-seedance",
    controlToken: "FPAI_CONTROL_TOKEN",
    falKey: "FAL_KEY",
    allowlist: {
      projectId: SEEDANCE_CONTROLLED_TEST.projectId,
      sceneId: SEEDANCE_CONTROLLED_TEST.sceneId,
      shotId: SEEDANCE_CONTROLLED_TEST.shotId,
      provider: SEEDANCE_CONTROLLED_TEST.provider,
      mode: SEEDANCE_CONTROLLED_TEST.mode,
      duration: SEEDANCE_CONTROLLED_TEST.duration,
      resolution: SEEDANCE_CONTROLLED_TEST.resolution,
      generateAudio: SEEDANCE_CONTROLLED_TEST.generateAudio,
    },
    maxJobs: SEEDANCE_CONTROLLED_TEST.maxJobs,
    maxEstimatedCostUsd: SEEDANCE_CONTROLLED_TEST.maxEstimatedCostUsd,
    failClosedAfterFirstJob: true,
  },
  blockedUntil: [
    "FAL_KEY is stored as a Worker secret (not a browser/Vite variable)",
    "Jasmine and Mikey Character Bible identity images exist and are approved",
    "A Scene 001 tarmac/environment reference is available",
    "Shot timing and scene animatic are approved",
    "Owner reviews the quote and the $1.46 Seedance controlled-test ceiling",
    "Owner explicitly sets SEEDANCE_LIVE_ENABLED=true for this one test only",
    "LIVE_RENDERING_ENABLED remains false. MOCK_E2E_VERIFIED is not used to authorize Seedance.",
  ],
  request: {
    projectId: SEEDANCE_CONTROLLED_TEST.projectId,
    sceneId: SEEDANCE_CONTROLLED_TEST.sceneId,
    shotId: SEEDANCE_CONTROLLED_TEST.shotId,
    provider: "seedance-fast",
    endpointId: built.endpointId,
    mode: built.mode,
    duration: 6,
    resolution: "720p",
    aspectRatio: "16:9",
    generateAudio: true,
    referenceCount: built.referenceCount,
    prompt: built.body.prompt,
    imageRoles: ["jasmine-identity", "mikey-identity", "tarmac-environment"],
  },
  quote: {
    estimatedCost: built.quote.estimatedCost,
    currency: "USD",
    ratePerSecond: built.quote.ratePerSecond,
    priceBasis: built.quote.priceBasis,
    pricingUpdatedAt: SEEDANCE_PRICING_UPDATED_AT,
    rates: DEFAULT_SEEDANCE_RATES,
  },
  rationale: {
    providerSelected: "seedance-fast",
    selectionReason: built.quote && `${built.mode} · Fast tier for the first inexpensive reference-driven test. Standard remains the cinematic follow-up. Veo is not used for this first test.`,
    estimatedCost: built.quote.estimatedCost,
    resolution: "720p",
    audio: true,
    referenceCount: built.referenceCount,
  },
};

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(outFile, `${JSON.stringify(packet, null, 2)}\n`);

console.log(`First controlled Seedance test plan: ${outFile}`);
console.log(`Endpoint: ${built.endpointId}`);
console.log(`Quote: $${built.quote.estimatedCost} (no API call made)`);
console.log("THIS SCRIPT DOES NOT SUBMIT A GENERATION.");
console.log("LIVE_RENDERING_ENABLED stays false. MOCK_E2E_VERIFIED is not used for Seedance.");
console.log("SEEDANCE_LIVE_ENABLED stays false in the repo.");
