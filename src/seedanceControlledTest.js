import { buildSeedanceRequest } from "./seedanceRequest.js";

/** Hard-limit for the isolated Seedance controlled test. Not env-overridable. */
export const SEEDANCE_CONTROLLED_TEST = Object.freeze({
  project: "Enemies Closer",
  projectId: "enemies-closer-ep01",
  sceneId: "001",
  shotId: "seedance-001-jasmine-mikey",
  provider: "seedance-fast",
  mode: "reference-to-video",
  duration: 6,
  resolution: "720p",
  generateAudio: true,
  maxEstimatedCostUsd: 1.46,
  maxJobs: 1,
});

export function seedanceLiveFlagEnabled(env = {}) {
  return env.SEEDANCE_LIVE_ENABLED === "true";
}

export function seedancePlanMismatches(input = {}, env = {}) {
  const plan = SEEDANCE_CONTROLLED_TEST;
  const built = buildSeedanceRequest({ ...input, provider: input.provider }, env);
  const audio = built.audio === true;
  const mismatches = [];
  if (input.projectId !== plan.projectId) mismatches.push("projectId");
  if (String(input.sceneId) !== plan.sceneId) mismatches.push("sceneId");
  if (input.shotId !== plan.shotId) mismatches.push("shotId");
  if (input.provider !== plan.provider) mismatches.push("provider");
  if (built.mode !== plan.mode) mismatches.push("mode");
  if (Number(input.duration) !== plan.duration) mismatches.push("duration");
  if (input.resolution !== plan.resolution) mismatches.push("resolution");
  if (audio !== plan.generateAudio) mismatches.push("generateAudio");
  return mismatches;
}

export function seedanceEstimatedCostAllowed(estimatedCost) {
  const value = Number(estimatedCost);
  return Number.isFinite(value) && value <= SEEDANCE_CONTROLLED_TEST.maxEstimatedCostUsd;
}
