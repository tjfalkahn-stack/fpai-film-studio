import {
  DEFAULT_SEEDANCE_RATES,
  SEEDANCE_PRICING_UPDATED_AT,
} from "./seedancePricing.js";

export const ECONOMY_SCHEMA_VERSION = 1;
export const PRICING_UPDATED_AT = "2026-09-03";
export { SEEDANCE_PRICING_UPDATED_AT };

const round = (value, places = 4) => {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

const finiteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, finiteNumber(value, min)));
const money = (value) => round(value, 4);

export const DEFAULT_ECONOMY_SETTINGS = Object.freeze({
  schemaVersion: ECONOMY_SCHEMA_VERSION,
  generationTarget: 125,
  workingCeiling: 200,
  emergencyCeiling: 250,
  requireAnimaticLock: true,
  defaultMaxAttempts: 2,
  paidMotionShare: 0.6,
  editYield: 1.3,
  planningAttempts: 1.8,
  blendedRate: 0.08,
  roundingOverhead: 1.15,
  defaultResolution: "720p",
  providerExecutionEnabled: false,
  serverAdapterConnected: false,
  pricingUpdatedAt: PRICING_UPDATED_AT,
});

export const ROUTES = Object.freeze([
  {
    id: "local-composite",
    label: "Local Composite",
    provider: "local",
    model: "editorial-composite",
    tier: "local",
    resolution: "source",
    ratePerSecond: 0,
    paid: false,
    description: "Screens, graphics, audio-led shots, overlays, effects, and editorial assembly.",
  },
  {
    id: "still-motion",
    label: "Still + Local Motion",
    provider: "local",
    model: "still-camera-motion",
    tier: "local",
    resolution: "source",
    ratePerSecond: 0,
    paid: false,
    description: "Approved still frame with local pan, push, depth, grain, and atmosphere.",
  },
  {
    id: "vault-reuse",
    label: "Clip Vault Reuse",
    provider: "local",
    model: "approved-clip-reuse",
    tier: "reuse",
    resolution: "source",
    ratePerSecond: 0,
    paid: false,
    description: "Reuse approved footage or salvaged ranges already paid for.",
  },
  {
    id: "comfy",
    label: "ComfyUI · Identity Still",
    provider: "comfy",
    renderer: "comfy",
    model: "comfyui-character-still",
    tier: "comfy",
    resolution: "source",
    ratePerSecond: 0,
    paid: false,
    audio: false,
    maxReferences: 6,
    description: "Character stills, identity assets, and reference preparation. Not a video generation route.",
  },
  {
    id: "seedance-fast-720",
    label: "Seedance 2.0 Fast · 720p",
    provider: "seedance",
    renderer: "seedance-fast",
    model: "bytedance/seedance-2.0/fast",
    apiSurface: "fal-queue",
    tier: "seedance-fast",
    durationPolicy: "flexible",
    minDuration: 4,
    maxDuration: 15,
    resolution: "720p",
    ratePerSecond: DEFAULT_SEEDANCE_RATES["fast-720p"],
    paid: true,
    audio: true,
    maxReferences: 9,
    referenceVideo: true,
    description: "Draft motion, coverage, transitions, and inexpensive reference-driven tests. Audio-capable.",
  },
  {
    id: "seedance-standard-720",
    label: "Seedance 2.0 Standard · 720p",
    provider: "seedance",
    renderer: "seedance-standard",
    model: "bytedance/seedance-2.0",
    apiSurface: "fal-queue",
    tier: "seedance-standard",
    durationPolicy: "flexible",
    minDuration: 4,
    maxDuration: 15,
    resolution: "720p",
    ratePerSecond: DEFAULT_SEEDANCE_RATES["standard-720p"],
    paid: true,
    audio: true,
    maxReferences: 9,
    referenceVideo: true,
    description: "Higher-quality cinematic character shots, reference-driven scenes, and audio-enabled takes.",
  },
  {
    id: "seedance-standard-1080",
    label: "Seedance 2.0 Standard · 1080p",
    provider: "seedance",
    renderer: "seedance-standard",
    model: "bytedance/seedance-2.0",
    apiSurface: "fal-queue",
    tier: "seedance-standard",
    durationPolicy: "flexible",
    minDuration: 4,
    maxDuration: 15,
    resolution: "1080p",
    ratePerSecond: DEFAULT_SEEDANCE_RATES["standard-1080p"],
    paid: true,
    audio: true,
    maxReferences: 9,
    referenceVideo: true,
    description: "Native 1080p Seedance Standard for detail-critical character and reference-driven scenes.",
  },
  {
    id: "omni-flash-720",
    label: "Gemini Omni Flash · 720p",
    provider: "google",
    model: "gemini-omni-1.1-flash",
    apiSurface: "interactions",
    tier: "omni",
    resolution: "720p",
    ratePerSecond: 0.1,
    paid: true,
    durationPolicy: "flexible",
    minDuration: 3,
    maxDuration: 10,
    description: "Default short-form route for coherent character motion, references, interpolation, and conversational repair.",
  },
  {
    id: "veo-lite-720",
    label: "Veo 3.1 Lite · 720p",
    provider: "google",
    model: "veo-3.1-lite-generate-preview",
    apiSurface: "generateVideos",
    tier: "lite",
    durationPolicy: "fixed",
    fixedDuration: 8,
    resolution: "720p",
    ratePerSecond: 0.05,
    paid: true,
    description: "Low-cost generic motion, environments, inserts, and non-critical coverage.",
  },
  {
    id: "veo-lite-1080",
    label: "Veo 3.1 Lite · 1080p",
    provider: "google",
    model: "veo-3.1-lite-generate-preview",
    apiSurface: "generateVideos",
    tier: "lite",
    durationPolicy: "fixed",
    fixedDuration: 8,
    resolution: "1080p",
    ratePerSecond: 0.08,
    paid: true,
    description: "Lite generation where native detail is worth the extra cost.",
  },
  {
    id: "veo-fast-720",
    label: "Veo 3.1 Fast · 720p",
    provider: "google",
    model: "veo-3.1-fast-generate-preview",
    apiSurface: "generateVideos",
    tier: "fast",
    durationPolicy: "fixed",
    fixedDuration: 8,
    resolution: "720p",
    ratePerSecond: 0.1,
    paid: true,
    description: "Principal characters, vehicles, action, and identity-sensitive motion.",
  },
  {
    id: "veo-fast-1080",
    label: "Veo 3.1 Fast · 1080p",
    provider: "google",
    model: "veo-3.1-fast-generate-preview",
    apiSurface: "generateVideos",
    tier: "fast",
    durationPolicy: "fixed",
    fixedDuration: 8,
    resolution: "1080p",
    ratePerSecond: 0.12,
    paid: true,
    description: "Identity-sensitive motion requiring native 1080p detail.",
  },
  {
    id: "veo-fast-4k",
    label: "Veo 3.1 Fast · 4K",
    provider: "google",
    model: "veo-3.1-fast-generate-preview",
    apiSurface: "generateVideos",
    tier: "fast",
    durationPolicy: "fixed",
    fixedDuration: 8,
    resolution: "4k",
    ratePerSecond: 0.3,
    paid: true,
    description: "Rare deep-crop or premium finishing case. Owner override recommended.",
  },
  {
    id: "veo-standard-720",
    label: "Veo 3.1 Standard · 720p",
    provider: "google",
    model: "veo-3.1-generate-preview",
    apiSurface: "generateVideos",
    tier: "standard",
    durationPolicy: "fixed",
    fixedDuration: 8,
    resolution: "720p",
    ratePerSecond: 0.4,
    paid: true,
    description: "Escalation route for approved hero shots after cheaper routes fail.",
  },
  {
    id: "veo-standard-1080",
    label: "Veo 3.1 Standard · 1080p",
    provider: "google",
    model: "veo-3.1-generate-preview",
    apiSurface: "generateVideos",
    tier: "standard",
    durationPolicy: "fixed",
    fixedDuration: 8,
    resolution: "1080p",
    ratePerSecond: 0.4,
    paid: true,
    description: "Escalation route for detail-critical hero shots. Owner override required.",
  },
  {
    id: "veo-standard-4k",
    label: "Veo 3.1 Standard · 4K",
    provider: "google",
    model: "veo-3.1-generate-preview",
    apiSurface: "generateVideos",
    tier: "standard",
    durationPolicy: "fixed",
    fixedDuration: 8,
    resolution: "4k",
    ratePerSecond: 0.6,
    paid: true,
    description: "Highest-cost hero route. Explicit owner override required.",
  },
]);

export const ROUTE_BY_ID = Object.freeze(Object.fromEntries(ROUTES.map((route) => [route.id, route])));
export const OMNI_DURATION_RANGE = Object.freeze({ min: 3, max: 10 });
export const VEO_CLIP_DURATION = 8;

export function rendererForRoute(routeOrId) {
  const route = typeof routeOrId === "string" ? ROUTE_BY_ID[routeOrId] : routeOrId;
  if (!route) return null;
  if (route.renderer) return route.renderer;
  if (String(route.id || "").startsWith("seedance-fast")) return "seedance-fast";
  if (String(route.id || "").startsWith("seedance-standard")) return "seedance-standard";
  if (String(route.id || "").startsWith("veo-fast")) return "veo-fast";
  if (String(route.id || "").startsWith("veo-standard")) return "veo-standard";
  if (String(route.id || "").startsWith("comfy")) return "comfy";
  return route.provider;
}

export function normalizeEconomySettings(project = {}) {
  const source = project.economy || {};
  const settings = {
    ...DEFAULT_ECONOMY_SETTINGS,
    ...source,
  };

  settings.generationTarget = Math.max(0, finiteNumber(settings.generationTarget, DEFAULT_ECONOMY_SETTINGS.generationTarget));
  settings.workingCeiling = Math.max(settings.generationTarget, finiteNumber(settings.workingCeiling, DEFAULT_ECONOMY_SETTINGS.workingCeiling));
  settings.emergencyCeiling = Math.max(settings.workingCeiling, finiteNumber(settings.emergencyCeiling, DEFAULT_ECONOMY_SETTINGS.emergencyCeiling));
  settings.defaultMaxAttempts = Math.max(1, Math.round(finiteNumber(settings.defaultMaxAttempts, DEFAULT_ECONOMY_SETTINGS.defaultMaxAttempts)));
  settings.paidMotionShare = clamp(settings.paidMotionShare, 0, 1);
  settings.editYield = Math.max(0.1, finiteNumber(settings.editYield, DEFAULT_ECONOMY_SETTINGS.editYield));
  settings.planningAttempts = Math.max(1, finiteNumber(settings.planningAttempts, DEFAULT_ECONOMY_SETTINGS.planningAttempts));
  settings.blendedRate = Math.max(0, finiteNumber(settings.blendedRate, DEFAULT_ECONOMY_SETTINGS.blendedRate));
  settings.roundingOverhead = Math.max(1, finiteNumber(settings.roundingOverhead, DEFAULT_ECONOMY_SETTINGS.roundingOverhead));
  settings.providerExecutionEnabled = Boolean(settings.providerExecutionEnabled);
  settings.serverAdapterConnected = Boolean(settings.serverAdapterConnected);
  settings.requireAnimaticLock = settings.requireAnimaticLock !== false;
  settings.pricingUpdatedAt = settings.pricingUpdatedAt || PRICING_UPDATED_AT;
  return settings;
}

export function updateEconomySettings(project, patch = {}) {
  const merged = normalizeEconomySettings({
    ...project,
    economy: { ...normalizeEconomySettings(project), ...patch },
  });
  return { ...project, economy: merged };
}

export function planClipDurations(finalSeconds, routeOrId = "omni-flash-720") {
  const target = Math.max(0, Number(finalSeconds) || 0);
  if (target === 0) return [];
  const route = typeof routeOrId === "string" ? ROUTE_BY_ID[routeOrId] : routeOrId;
  if (!route?.paid) return [];

  if (route.durationPolicy === "fixed") {
    const duration = Number(route.fixedDuration || VEO_CLIP_DURATION);
    return Array.from({ length: Math.ceil(target / duration) }, () => duration);
  }

  const minDuration = Math.max(1, Number(route.minDuration || OMNI_DURATION_RANGE.min));
  const maxDuration = Math.max(minDuration, Number(route.maxDuration || OMNI_DURATION_RANGE.max));
  const total = Math.max(minDuration, Math.ceil(target));
  const count = Math.max(1, Math.ceil(total / maxDuration));
  const durations = Array.from({ length: count }, () => minDuration);
  let remaining = total - minDuration * count;
  for (let index = 0; index < durations.length && remaining > 0; index += 1) {
    const add = Math.min(maxDuration - minDuration, remaining);
    durations[index] += add;
    remaining -= add;
  }
  return durations.sort((a, b) => b - a);
}

export function normalizeShotEconomy(shot = {}, project = {}) {
  const settings = normalizeEconomySettings(project);
  const text = `${shot.subject || ""} ${shot.move || ""} ${shot.prompt || ""}`.toLowerCase();
  const localPattern = /\b(black|screen|text message|document|title card|computer|phone screen|map|logo|credits)\b/;
  const stillPattern = /\b(still|locked frame|photograph|portrait insert)\b/;
  const actionPattern = /\b(explosion|fire|gun|fight|stunt|pursuit|chase|convoy|vehicle|truck|car|jet|aerial|drone|crash)\b/;
  const dialoguePattern = /\b(dialogue|speaks|says|talks|mouth|lip|close-up|ecu)\b|:/;
  const hero = Boolean(shot.economy?.hero ?? shot.status === "Hero");
  const characterCount = Array.isArray(shot.characters) ? shot.characters.length : 0;

  const derivedMotionNeed = localPattern.test(text) ? "local" : stillPattern.test(text) ? "still" : "generative";
  const derivedComplexity = actionPattern.test(text) ? 3 : characterCount > 1 ? 2 : 1;
  const derivedIdentityRisk = characterCount > 1 ? 3 : characterCount === 1 ? 2 : 0;
  const derivedLipVisible = dialoguePattern.test(text) && characterCount > 0;
  const derivedReuse = characterCount === 0 ? "high" : hero ? "medium" : "low";
  const defaultCap = hero ? 3 : actionPattern.test(text) ? 1.5 : characterCount ? 1 : 0.6;

  return {
    animaticApproved: Boolean(shot.economy?.animaticApproved),
    motionNeed: shot.economy?.motionNeed || derivedMotionNeed,
    complexity: clamp(shot.economy?.complexity ?? derivedComplexity, 0, 3),
    identityRisk: clamp(shot.economy?.identityRisk ?? derivedIdentityRisk, 0, 3),
    lipVisible: Boolean(shot.economy?.lipVisible ?? derivedLipVisible),
    hero,
    reusePotential: shot.economy?.reusePotential || derivedReuse,
    reuseAssetId: shot.economy?.reuseAssetId || null,
    nativeDetail: Boolean(shot.economy?.nativeDetail),
    manualRouteId: shot.economy?.manualRouteId || "auto",
    maxAttempts: Math.max(1, Math.round(Number(shot.economy?.maxAttempts) || settings.defaultMaxAttempts)),
    shotCap: Math.max(0, Number(shot.economy?.shotCap ?? defaultCap)),
    aspectRatio: shot.economy?.aspectRatio || "16:9",
    localAudio: shot.economy?.localAudio !== false,
    notes: shot.economy?.notes || "",
  };
}

export function classifyShot(shot = {}, project = {}) {
  const economy = normalizeShotEconomy(shot, project);
  const text = `${shot.subject || ""} ${shot.move || ""} ${shot.prompt || ""}`.toLowerCase();

  if (economy.reuseAssetId) return "vault-reuse";
  if (economy.motionNeed === "local") return "local-render";
  if (economy.motionNeed === "still") return "still-motion";
  if (economy.hero) return "hero";
  if (economy.lipVisible) return "visible-dialogue";
  if (/\b(convoy|vehicle|truck|car|pursuit|chase|crash)\b/.test(text)) return "vehicle-motion";
  if (/\b(explosion|fire|gun|fight|stunt|jet|aerial|drone|crowd)\b/.test(text) || economy.complexity >= 3) return "complex-action";
  if ((shot.characters || []).length > 1 || economy.identityRisk >= 3) return "multi-character";
  if ((shot.characters || []).length === 1 || economy.identityRisk >= 2) return "identity-motion";
  return "generic-motion";
}

export function candidateRouteIdsForShot(shot = {}, project = {}) {
  const economy = normalizeShotEconomy(shot, project);
  const shotClass = classifyShot(shot, project);
  if (economy.manualRouteId !== "auto" && ROUTE_BY_ID[economy.manualRouteId]) return [economy.manualRouteId];
  if (shotClass === "vault-reuse") return ["vault-reuse"];
  if (shotClass === "local-render") return ["local-composite"];
  if (shotClass === "still-motion") return ["still-motion"];

  if (economy.nativeDetail) {
    if (shotClass === "hero") return ["veo-fast-1080", "veo-standard-1080", "seedance-standard-1080"];
    return shotClass === "generic-motion"
      ? ["veo-lite-1080", "veo-fast-1080", "seedance-standard-1080"]
      : ["veo-fast-1080", "seedance-standard-1080"];
  }
  if (shotClass === "hero") return ["omni-flash-720", "veo-fast-720", "seedance-standard-720", "veo-standard-720"];
  if (shotClass === "generic-motion") return ["omni-flash-720", "veo-lite-720", "seedance-fast-720", "veo-fast-720"];
  if (shotClass === "visible-dialogue" || shotClass === "identity-motion" || shotClass === "multi-character") {
    return ["omni-flash-720", "seedance-standard-720", "veo-fast-720"];
  }
  return ["omni-flash-720", "veo-fast-720", "seedance-fast-720"];
}

export function defaultRouteIdForShot(shot = {}, project = {}) {
  const candidates = candidateRouteIdsForShot(shot, project);
  if (candidates.length === 1) return candidates[0];
  return candidates
    .map((routeId) => ({ routeId, estimate: estimateRouteCost(routeId, shot, [], project) }))
    .sort((a, b) => a.estimate.expectedCost - b.estimate.expectedCost || candidates.indexOf(a.routeId) - candidates.indexOf(b.routeId))[0].routeId;
}

export function selectEconomicalRoute(shot = {}, ledger = [], project = {}) {
  const candidates = candidateRouteIdsForShot(shot, project);
  const performance = providerPerformance(ledger);
  const scored = candidates.map((routeId, order) => {
    const route = ROUTE_BY_ID[routeId];
    const estimate = estimateRouteCost(route, shot, ledger, project);
    const learned = performance[routeId];
    const learnedScore = learned?.requests >= 3 && learned.costPerUsableSecond != null
      ? money(learned.costPerUsableSecond * Math.max(0.1, Number(shot.sec) || 0.1))
      : null;
    return {
      route,
      estimate,
      learned,
      score: learnedScore ?? estimate.expectedCost,
      scoreSource: learnedScore == null ? "default" : "learned",
      order,
    };
  });
  return scored.sort((a, b) => a.score - b.score || a.order - b.order)[0];
}

export function providerPerformance(ledger = []) {
  const groups = {};
  for (const entry of ledger) {
    const routeId = entry.routeId || `${entry.provider || "unknown"}/${entry.model || "unknown"}`;
    groups[routeId] ||= {
      routeId,
      requests: 0,
      approved: 0,
      rejected: 0,
      actualCost: 0,
      generatedSeconds: 0,
      usableSeconds: 0,
    };
    const group = groups[routeId];
    if (["completed", "failed"].includes(entry.generationStatus)) group.requests += 1;
    if (entry.approvalStatus === "approved") group.approved += 1;
    if (entry.approvalStatus === "rejected") group.rejected += 1;
    group.actualCost += Number(entry.actualCost || 0);
    group.generatedSeconds += Number(entry.generatedSeconds || entry.requestSeconds || 0);
    group.usableSeconds += Number(entry.usableSeconds || 0);
  }

  for (const group of Object.values(groups)) {
    group.acceptanceRate = group.requests ? group.approved / group.requests : null;
    group.costPerUsableSecond = group.usableSeconds ? group.actualCost / group.usableSeconds : null;
    group.attemptsPerApproval = group.approved ? group.requests / group.approved : null;
    group.actualCost = money(group.actualCost);
    group.generatedSeconds = round(group.generatedSeconds, 2);
    group.usableSeconds = round(group.usableSeconds, 2);
  }
  return groups;
}

export function expectedAttemptsForRoute(route, shotClass, ledger = [], maxAttempts = 2) {
  if (!route.paid) return 1;
  const learned = providerPerformance(ledger)[route.id];
  if (learned?.requests >= 3 && learned.attemptsPerApproval) {
    return round(clamp(learned.attemptsPerApproval, 1, maxAttempts), 2);
  }

  const byTier = {
    omni: {
      "generic-motion": 1.25,
      "identity-motion": 1.35,
      "multi-character": 1.55,
      "visible-dialogue": 1.65,
      "vehicle-motion": 1.45,
      "complex-action": 1.6,
      hero: 1.75,
    },
    lite: {
      "generic-motion": 1.45,
      "identity-motion": 2.15,
      "multi-character": 2.35,
      "visible-dialogue": 2.4,
      "vehicle-motion": 2.05,
      "complex-action": 2.2,
      hero: 2.4,
    },
    fast: {
      "generic-motion": 1.2,
      "identity-motion": 1.55,
      "multi-character": 1.75,
      "visible-dialogue": 1.8,
      "vehicle-motion": 1.55,
      "complex-action": 1.7,
      hero: 1.8,
    },
    standard: {
      "generic-motion": 1.1,
      "identity-motion": 1.2,
      "multi-character": 1.3,
      "visible-dialogue": 1.35,
      "vehicle-motion": 1.25,
      "complex-action": 1.3,
      hero: 1.35,
    },
    "seedance-fast": {
      "generic-motion": 1.3,
      "identity-motion": 1.45,
      "multi-character": 1.55,
      "visible-dialogue": 1.5,
      "vehicle-motion": 1.4,
      "complex-action": 1.5,
      hero: 1.6,
    },
    "seedance-standard": {
      "generic-motion": 1.15,
      "identity-motion": 1.25,
      "multi-character": 1.35,
      "visible-dialogue": 1.3,
      "vehicle-motion": 1.25,
      "complex-action": 1.3,
      hero: 1.4,
    },
  };
  return round(Math.min(maxAttempts, byTier[route.tier]?.[shotClass] || 1.5), 2);
}

export function estimateRouteCost(routeOrId, shot = {}, ledger = [], project = {}) {
  const route = typeof routeOrId === "string" ? ROUTE_BY_ID[routeOrId] : routeOrId;
  if (!route) throw new Error("Unknown generation route.");
  const economy = normalizeShotEconomy(shot, project);
  const shotClass = classifyShot(shot, project);
  const clipDurations = route.paid ? planClipDurations(shot.sec, route) : [];
  const requestSeconds = clipDurations.reduce((sum, value) => sum + value, 0);
  const oneAttemptCost = money(requestSeconds * route.ratePerSecond);
  const expectedAttempts = expectedAttemptsForRoute(route, shotClass, ledger, economy.maxAttempts);
  const expectedCost = money(oneAttemptCost * expectedAttempts);
  const maxExposure = money(oneAttemptCost * economy.maxAttempts);
  const usableSeconds = Math.max(0.1, Number(shot.sec) || 0.1);

  return {
    clipDurations,
    requestSeconds,
    oneAttemptCost,
    expectedAttempts,
    expectedCost,
    maxExposure,
    costPerFinishedSecond: money(expectedCost / usableSeconds),
  };
}

export function routeShot(shot = {}, ledger = [], project = {}) {
  const selected = selectEconomicalRoute(shot, ledger, project);
  const route = selected.route;
  return {
    ...route,
    shotClass: classifyShot(shot, project),
    estimate: selected.estimate,
    routingScore: selected.score,
    routingScoreSource: selected.scoreSource,
    fallbackRouteIds: fallbackRoutes(route.id, shot, project),
    renderer: rendererForRoute(route),
    rationale: routingRationale(selected, shot, project),
  };
}

export function routingRationale(selected, shot = {}, project = {}, extras = {}) {
  const route = selected.route;
  const economy = normalizeShotEconomy(shot, project);
  const shotClass = classifyShot(shot, project);
  let selectionReason;
  if (economy.manualRouteId !== "auto" && ROUTE_BY_ID[economy.manualRouteId]) {
    selectionReason = `Manual route override (${economy.manualRouteId}).`;
  } else if (selected.scoreSource === "learned") {
    selectionReason = `Learned cost per usable second favored ${route.id}.`;
  } else if (String(route.renderer || route.id || "").includes("veo")) {
    selectionReason = `Veo is the economical justified route for ${shotClass}.`;
  } else if (String(route.renderer || route.id || "").includes("seedance")) {
    selectionReason = `Seedance is the economical candidate for ${shotClass}; Veo remains available for premium hero shots.`;
  } else {
    selectionReason = `Lowest expected-cost candidate for ${shotClass}. Seedance is not selected when cheaper accepted routes exist.`;
  }
  return {
    providerSelected: rendererForRoute(route),
    selectionReason,
    estimatedCost: selected.estimate?.expectedCost ?? extras.estimatedCost ?? 0,
    resolution: route.resolution,
    audio: Boolean(route.audio),
    referenceCount: Number(extras.referenceCount || 0),
  };
}

export function fallbackRoutes(routeId, shot = {}, project = {}) {
  const economy = normalizeShotEconomy(shot, project);
  if (routeId === "local-composite") return ["still-motion", "omni-flash-720", "veo-lite-720"];
  if (routeId === "still-motion") return ["local-composite", "omni-flash-720", "veo-lite-720"];
  if (routeId === "vault-reuse") return ["local-composite", "still-motion"];
  if (routeId === "comfy") return ["still-motion", "local-composite"];
  if (routeId.startsWith("seedance-fast")) return ["omni-flash-720", "veo-lite-720", "still-motion", "local-composite"];
  if (routeId.startsWith("seedance-standard")) {
    return economy.hero
      ? ["veo-fast-720", "veo-standard-720", "omni-flash-720", "still-motion"]
      : ["seedance-fast-720", "omni-flash-720", "veo-fast-720", "still-motion"];
  }
  if (routeId === "omni-flash-720") return economy.hero
    ? ["veo-fast-720", "veo-standard-720", "still-motion", "local-composite"]
    : ["veo-lite-720", "seedance-fast-720", "veo-fast-720", "still-motion", "local-composite"];
  if (routeId.startsWith("veo-lite")) return ["omni-flash-720", "seedance-fast-720", "veo-fast-720", "still-motion", "local-composite"];
  if (routeId.startsWith("veo-fast")) {
    return economy.hero ? ["omni-flash-720", "veo-standard-720", "seedance-standard-720", "still-motion", "local-composite"] : ["omni-flash-720", "veo-lite-720", "seedance-fast-720", "still-motion", "local-composite"];
  }
  return ["omni-flash-720", "veo-fast-720", "still-motion", "local-composite"];
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableHash(value) {
  const text = stableSerialize(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fpai-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildGenerationPlan({ shot, project = {}, characters = [], assets = [], ledger = [] }) {
  const economy = normalizeShotEconomy(shot, project);
  const route = routeShot(shot, ledger, project);
  const characterRefs = characters
    .flatMap((character) => Object.values(character?.refs || {}).map((reference) => reference?.key).filter(Boolean))
    .sort();
  const assetRefs = assets.map((asset) => asset?.mediaKey || asset?.id).filter(Boolean).sort();
  const localAudioInstruction = economy.lipVisible && economy.localAudio
    ? "Picture performance only; final dialogue and lip correction are handled locally."
    : "Use generated production sound only as reference audio.";
  const prompt = [
    `${shot.mode || "CONTROL"} mode`,
    `${shot.subject || "Untitled shot"}`,
    `${shot.move || "Locked camera"}`,
    `final edit ${Number(shot.sec || 0)} seconds`,
    `identity drift ${shot.drift || project.drift || "STRICT"}`,
    localAudioInstruction,
    shot.prompt || "",
  ].filter(Boolean).join(" · ");

  const requestCore = {
    schemaVersion: ECONOMY_SCHEMA_VERSION,
    projectId: project.id || null,
    sceneId: shot.scene || null,
    shotId: shot.id || null,
    routeId: route.id,
    model: route.model,
    apiSurface: route.apiSurface || "local",
    durationPolicy: route.durationPolicy || "local",
    resolution: route.resolution,
    aspectRatio: economy.aspectRatio,
    clipDurations: route.estimate.clipDurations,
    prompt,
    characterRefs,
    assetRefs,
    reuseAssetId: economy.reuseAssetId,
  };

  return {
    id: `plan-${shot.scene || "scene"}-${shot.id || "shot"}-${stableHash(requestCore).slice(-8)}`,
    requestHash: stableHash(requestCore),
    shotClass: route.shotClass,
    route,
    economy,
    prompt,
    characterRefs,
    assetRefs,
    requestSeconds: route.estimate.requestSeconds,
    oneAttemptCost: route.estimate.oneAttemptCost,
    expectedCost: route.estimate.expectedCost,
    maxExposure: route.estimate.maxExposure,
    jobs: route.paid
      ? route.estimate.clipDurations.map((durationSeconds, index) => ({
          jobIndex: index,
          provider: route.provider,
          renderer: rendererForRoute(route),
          model: route.model,
          apiSurface: route.apiSurface,
          durationPolicy: route.durationPolicy,
          resolution: route.resolution,
          aspectRatio: economy.aspectRatio,
          durationSeconds,
          generateAudio: Boolean(route.audio),
          prompt: `${prompt} · provider segment ${index + 1}/${route.estimate.clipDurations.length} · output exactly ${durationSeconds} seconds`,
        }))
      : [],
    routing: {
      ...(route.rationale || {}),
      providerSelected: rendererForRoute(route),
      estimatedCost: route.estimate.expectedCost,
      resolution: route.resolution,
      audio: Boolean(route.audio),
      referenceCount: characterRefs.length,
    },
  };
}

export function findDuplicateRequest(ledger = [], requestHash) {
  if (!requestHash) return null;
  return ledger.find((entry) =>
    entry.requestHash === requestHash &&
    !["failed", "canceled"].includes(entry.generationStatus)
  ) || null;
}

export function attemptsUsedForShot(ledger = [], shotId) {
  return ledger.filter((entry) =>
    entry.shotId === shotId &&
    entry.provider !== "mock" &&
    entry.routeId &&
    !["canceled"].includes(entry.generationStatus)
  ).length;
}

export function generationSpend(ledger = []) {
  return ledger.reduce((summary, entry) => {
    const isGeneration = Boolean(entry.routeId) || /generation|video|retry/i.test(entry.generationType || "");
    if (!isGeneration) return summary;
    if (["planned", "queued", "running"].includes(entry.generationStatus)) {
      summary.committed += Number(entry.estimatedCost || 0);
    } else {
      summary.actual += Number(entry.actualCost || 0);
    }
    return summary;
  }, { actual: 0, committed: 0 });
}

export function evaluateBudgetGate({
  project = {},
  scene = {},
  shot = {},
  ledger = [],
  plan,
  continuityReady = false,
  ownerOverride = false,
}) {
  const settings = normalizeEconomySettings(project);
  const economy = normalizeShotEconomy(shot, project);
  const resolvedPlan = plan || buildGenerationPlan({ shot, project, ledger });
  const blockers = [];
  const warnings = [];
  const executionBlockers = [];
  const duplicate = findDuplicateRequest(ledger, resolvedPlan.requestHash);
  const attemptsUsed = attemptsUsedForShot(ledger, shot.id);
  const spend = generationSpend(ledger);
  const shotSpend = ledger
    .filter((entry) => entry.shotId === shot.id && entry.routeId)
    .reduce((sum, entry) => sum + Number(
      ["planned", "queued", "running"].includes(entry.generationStatus)
        ? entry.estimatedCost || 0
        : entry.actualCost || 0
    ), 0);
  const nextCost = resolvedPlan.oneAttemptCost;
  const projectedCommitted = money(spend.actual + spend.committed + nextCost);

  if (!resolvedPlan.route.paid) {
    warnings.push("This shot is routed to a local or reused method; no paid request should be queued.");
  }
  if (settings.requireAnimaticLock && !scene.animaticLocked) blockers.push("Scene animatic is not locked.");
  if (!economy.animaticApproved) blockers.push("Shot timing is not approved in the animatic.");
  if (!continuityReady) blockers.push("Continuity Gate has unresolved blockers.");
  if (duplicate) blockers.push(`Duplicate request already exists as ${duplicate.id}.`);
  if (attemptsUsed >= economy.maxAttempts) blockers.push(`Shot attempt limit reached (${attemptsUsed}/${economy.maxAttempts}).`);
  if (shotSpend + nextCost > economy.shotCap + 1e-9) blockers.push(`Next attempt would exceed the $${economy.shotCap.toFixed(2)} shot cap.`);
  if (projectedCommitted > settings.emergencyCeiling + 1e-9) blockers.push("Emergency generation ceiling would be exceeded.");
  else if (projectedCommitted > settings.workingCeiling + 1e-9 && !ownerOverride) blockers.push("Working generation ceiling requires owner override.");
  else if (projectedCommitted > settings.generationTarget + 1e-9) warnings.push("This request moves the production above the target generation budget.");
  if (resolvedPlan.route.tier === "standard" && !ownerOverride) blockers.push("Veo Standard requires explicit owner override.");
  if (resolvedPlan.route.resolution === "4k" && !ownerOverride) blockers.push("4K generation requires explicit owner override.");

  if (!settings.serverAdapterConnected) executionBlockers.push("Server-side Google adapter is not connected.");
  if (!settings.providerExecutionEnabled) executionBlockers.push("Paid provider execution is disabled.");

  const paidRequest = resolvedPlan.route.paid;
  return {
    blockers,
    warnings,
    executionBlockers,
    duplicate,
    attemptsUsed,
    attemptsRemaining: Math.max(0, economy.maxAttempts - attemptsUsed),
    shotSpend: money(shotSpend),
    nextCost,
    generationActual: money(spend.actual),
    generationCommitted: money(spend.committed),
    projectedCommitted,
    queueAllowed: paidRequest && blockers.length === 0,
    generateAllowed: paidRequest && blockers.length === 0 && executionBlockers.length === 0,
    localPlan: !paidRequest,
  };
}

export function createQueuedLedgerEntry({ plan, project = {}, shot = {}, timestamp = new Date().toISOString() }) {
  return {
    id: `queue-${shot.scene || "scene"}-${shot.id || "shot"}-${Date.now()}`,
    projectId: project.id || null,
    sceneId: shot.scene || null,
    shotId: shot.id || null,
    generationId: plan.id,
    provider: plan.route.provider,
    model: plan.route.model,
    routeId: plan.route.id,
    shotClass: plan.shotClass,
    generationType: "video generation",
    estimatedCost: plan.oneAttemptCost,
    actualCost: 0,
    generationStatus: "queued",
    approvalStatus: "pending",
    timestamp,
    requestHash: plan.requestHash,
    requestSeconds: plan.requestSeconds,
    generatedSeconds: 0,
    usableSeconds: 0,
    attemptNumber: 1,
    maxAttempts: plan.economy.maxAttempts,
    budgetCap: plan.economy.shotCap,
    label: `Shot ${shot.id} budget-safe queue`,
  };
}

export function normalizeUsableRanges(ranges = [], sourceDuration = Infinity) {
  const normalized = ranges
    .map((range) => ({
      start: clamp(range.start, 0, sourceDuration),
      end: clamp(range.end, 0, sourceDuration),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [];
  for (const range of normalized) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged.map((range) => ({ start: round(range.start, 2), end: round(range.end, 2) }));
}


export function parseUsableRangeText(value = "", sourceDuration = Infinity) {
  const ranges = String(value)
    .split(/[;,\n]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const match = token.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)$/i);
      return match ? { start: Number(match[1]), end: Number(match[2]) } : null;
    })
    .filter(Boolean);
  return normalizeUsableRanges(ranges, sourceDuration);
}

export function formatUsableRanges(ranges = []) {
  return normalizeUsableRanges(ranges).map((range) => `${range.start}-${range.end}`).join(", ");
}

export function usableSecondsFromRanges(ranges = [], sourceDuration = Infinity) {
  return round(normalizeUsableRanges(ranges, sourceDuration)
    .reduce((sum, range) => sum + range.end - range.start, 0), 2);
}

export function createSalvageRecord({ takeId, ranges = [], sourceDuration = 0, usableSeconds = null, uses = [], notes = "" }) {
  const safeDuration = Math.max(0, finiteNumber(sourceDuration, 0));
  const normalizedRanges = normalizeUsableRanges(ranges, safeDuration);
  const rangedSeconds = usableSecondsFromRanges(normalizedRanges, safeDuration);
  const measuredSeconds = usableSeconds == null
    ? rangedSeconds
    : round(clamp(usableSeconds, 0, safeDuration), 2);
  const reviewedSeconds = normalizedRanges.length ? rangedSeconds : measuredSeconds;
  return {
    takeId,
    sourceDuration: round(safeDuration, 2),
    ranges: normalizedRanges,
    usableSeconds: reviewedSeconds,
    uses,
    notes,
    status: reviewedSeconds > 0 ? "salvaged" : "unreviewed",
  };
}

export function fullRuntimeForecast(project = {}) {
  const settings = normalizeEconomySettings(project);
  const runtime = Math.max(0, Number(project.runtime) || 0);
  const paidFinalSeconds = runtime * settings.paidMotionShare;
  const sourceSeconds = paidFinalSeconds / settings.editYield;
  const generatedSeconds = sourceSeconds * settings.planningAttempts;
  const beforeOverhead = generatedSeconds * settings.blendedRate;
  const forecast = beforeOverhead * settings.roundingOverhead;
  const naiveCost = runtime * 4 * settings.blendedRate;
  const savings = Math.max(0, naiveCost - forecast);

  return {
    runtime,
    paidFinalSeconds: round(paidFinalSeconds, 1),
    sourceSeconds: round(sourceSeconds, 1),
    generatedSeconds: round(generatedSeconds, 1),
    forecast: money(forecast),
    naiveCost: money(naiveCost),
    savings: money(savings),
    savingsPercent: naiveCost ? round((savings / naiveCost) * 100, 1) : 0,
  };
}

export function calculateProductionEconomy({ project = {}, shots = [], ledger = [] }) {
  const settings = normalizeEconomySettings(project);
  const plans = shots.map((shot) => buildGenerationPlan({ shot, project, ledger }));
  const mappedFinalSeconds = shots.reduce((sum, shot) => sum + Number(shot.sec || 0), 0);
  const mappedPaidSeconds = plans.filter((plan) => plan.route.paid).reduce((sum, plan) => sum + Number(plan.requestSeconds || 0), 0);
  const mappedExpectedCost = plans.reduce((sum, plan) => sum + Number(plan.expectedCost || 0), 0);
  const mappedMaxExposure = plans.reduce((sum, plan) => sum + Number(plan.maxExposure || 0), 0);
  const localShotCount = plans.filter((plan) => !plan.route.paid).length;
  const spend = generationSpend(ledger);
  const forecast = fullRuntimeForecast(project);

  return {
    settings,
    plans,
    mappedFinalSeconds: round(mappedFinalSeconds, 1),
    mappedPaidSeconds: round(mappedPaidSeconds, 1),
    mappedExpectedCost: money(mappedExpectedCost),
    mappedMaxExposure: money(mappedMaxExposure),
    localShotCount,
    paidShotCount: plans.length - localShotCount,
    actual: money(spend.actual),
    committed: money(spend.committed),
    availableToTarget: money(settings.generationTarget - spend.actual - spend.committed),
    availableToWorking: money(settings.workingCeiling - spend.actual - spend.committed),
    forecast,
  };
}
