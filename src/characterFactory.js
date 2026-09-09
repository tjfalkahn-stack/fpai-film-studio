export const CHARACTER_FACTORY_VERSION = "1.0.0";

export const MEDIUM_PRESETS = Object.freeze({
  cinematic: {
    id: "cinematic",
    label: "Photoreal / Cinematic",
    prompt: "photoreal cinematic live-action, natural skin texture, physically plausible lighting, restrained film grain",
  },
  animation: {
    id: "animation",
    label: "Animation",
    prompt: "premium feature animation, dimensional characters, cinematic lighting, production-ready animated film frame",
  },
  anime: {
    id: "anime",
    label: "Anime",
    prompt: "cinematic anime, consistent character design, expressive linework, controlled cel shading, feature-quality composition",
  },
  cartoon: {
    id: "cartoon",
    label: "Cartoon",
    prompt: "stylized cartoon production art, clear silhouette, consistent model-sheet proportions, television-quality finish",
  },
  comic: {
    id: "comic",
    label: "Comic / Graphic Novel",
    prompt: "graphic novel illustration, strong ink language, controlled color treatment, consistent character model",
  },
  vintage: {
    id: "vintage",
    label: "Vintage / Period",
    prompt: "period-authentic image treatment, era-appropriate optics, texture and production design without modern artifacts",
  },
  hybrid: {
    id: "hybrid",
    label: "Experimental / Hybrid",
    prompt: "hybrid mixed-media cinematic image, coherent identity preserved across stylized treatment",
  },
});

export const CANONICAL_ANGLES = Object.freeze([
  { id: "identity-front", label: "Identity Front", framing: "head-and-shoulders straight-on portrait", required: true },
  { id: "three-quarter-left", label: "3/4 Left", framing: "head-and-shoulders three-quarter view facing camera-left", required: true },
  { id: "three-quarter-right", label: "3/4 Right", framing: "head-and-shoulders three-quarter view facing camera-right", required: true },
  { id: "profile-left", label: "Profile Left", framing: "true left profile portrait", required: true },
  { id: "profile-right", label: "Profile Right", framing: "true right profile portrait", required: true },
  { id: "full-body-front", label: "Full Body Front", framing: "full-body standing straight-on, head-to-toe visible", required: true },
  { id: "full-body-three-quarter", label: "Full Body 3/4", framing: "full-body standing three-quarter pose, head-to-toe visible", required: true },
  { id: "full-body-back", label: "Full Body Back", framing: "full-body rear view, head-to-toe visible", required: true },
]);

export const DEFAULT_EXPRESSIONS = Object.freeze([
  "neutral",
  "serious",
  "controlled anger",
  "aggressive",
  "concerned",
  "hurt",
  "exhausted",
]);

export const CONTINUITY_TESTS = Object.freeze([
  { id: "day-soft", label: "Soft Daylight", lighting: "soft natural daylight", lens: "50mm portrait lens" },
  { id: "night-hard", label: "Hard Night", lighting: "hard motivated night lighting", lens: "50mm portrait lens" },
  { id: "wide-35", label: "35mm Wide", lighting: "neutral studio lighting", lens: "35mm lens" },
  { id: "close-85", label: "85mm Close", lighting: "neutral studio lighting", lens: "85mm portrait lens" },
]);

function clean(value) {
  return String(value ?? "").trim();
}

function slug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "character";
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function normalizeCharacterProfile(input = {}) {
  const name = clean(input.name);
  if (!name) throw new Error("Character name is required.");

  const height = clean(input.height || input.heightDescription);
  const wardrobe = Array.isArray(input.wardrobe)
    ? input.wardrobe
    : clean(input.wardrobe)
      ? [input.wardrobe]
      : ["default look"];

  return {
    id: clean(input.id) || slug(name),
    name,
    role: clean(input.role),
    age: clean(input.age || input.ageRange),
    height,
    build: clean(input.build),
    skinTone: clean(input.skinTone),
    hair: clean(input.hair),
    facialHair: clean(input.facialHair),
    face: clean(input.face),
    eyes: clean(input.eyes),
    distinguishingFeatures: unique([...(input.distinguishingFeatures || [])].map(clean)),
    voice: clean(input.voice),
    behavior: clean(input.behavior || input.notes),
    wardrobe: unique(wardrobe.map(clean)),
    protectedTraits: unique([...(input.protectedTraits || [])].map(clean)),
    negativeTraits: unique([...(input.negativeTraits || [])].map(clean)),
  };
}

export function identityDescription(profile) {
  const parts = [
    profile.name,
    profile.role && `role: ${profile.role}`,
    profile.age && `age: ${profile.age}`,
    profile.height && `height: ${profile.height}`,
    profile.build && `build: ${profile.build}`,
    profile.skinTone && `skin tone: ${profile.skinTone}`,
    profile.hair && `hair: ${profile.hair}`,
    profile.facialHair && `facial hair: ${profile.facialHair}`,
    profile.face && `face: ${profile.face}`,
    profile.eyes && `eyes: ${profile.eyes}`,
    profile.distinguishingFeatures.length && `distinguishing features: ${profile.distinguishingFeatures.join(", ")}`,
  ].filter(Boolean);
  return parts.join("; ");
}

export function buildPrompt({ profile, medium, task, wardrobe, expression, lighting, lens }) {
  const mediumPreset = MEDIUM_PRESETS[medium] || MEDIUM_PRESETS.cinematic;
  const identity = identityDescription(profile);
  const protectedText = profile.protectedTraits.length
    ? ` Preserve exactly: ${profile.protectedTraits.join(", ")}.`
    : "";
  const negativeText = profile.negativeTraits.length
    ? ` Avoid: ${profile.negativeTraits.join(", ")}.`
    : "";
  return [
    `${mediumPreset.prompt}.`,
    `CHARACTER IDENTITY: ${identity}.`,
    task?.framing ? `FRAME: ${task.framing}.` : "",
    wardrobe ? `WARDROBE: ${wardrobe}.` : "",
    expression ? `EXPRESSION: ${expression}.` : "",
    lighting ? `LIGHTING: ${lighting}.` : "",
    lens ? `LENS: ${lens}.` : "",
    "Keep facial identity, apparent age, body proportions, height impression, skin tone, hairline, and distinguishing features consistent with the canonical identity.",
    "Single character only unless explicitly requested. Clean production reference image. No text, watermark, collage, duplicate person, or contact sheet.",
    protectedText,
    negativeText,
  ].filter(Boolean).join(" ");
}

export function createCharacterFactoryPlan(input = {}) {
  const profile = normalizeCharacterProfile(input.character || input);
  const medium = MEDIUM_PRESETS[input.medium]?.id || "cinematic";
  const expressions = unique((input.expressions || DEFAULT_EXPRESSIONS).map(clean));
  const wardrobes = unique((input.wardrobe || profile.wardrobe).map?.(clean) || profile.wardrobe);
  const jobs = [];

  for (const task of CANONICAL_ANGLES) {
    jobs.push({
      id: `${profile.id}/angles/${task.id}`,
      category: "angle",
      taskId: task.id,
      label: task.label,
      required: task.required,
      wardrobe: wardrobes[0],
      prompt: buildPrompt({ profile, medium, task, wardrobe: wardrobes[0], expression: "neutral", lighting: "neutral studio lighting", lens: "50mm lens" }),
    });
  }

  for (const expression of expressions) {
    const task = { framing: "head-and-shoulders straight-on portrait" };
    jobs.push({
      id: `${profile.id}/expressions/${slug(expression)}`,
      category: "expression",
      taskId: slug(expression),
      label: expression,
      required: true,
      wardrobe: wardrobes[0],
      prompt: buildPrompt({ profile, medium, task, wardrobe: wardrobes[0], expression, lighting: "neutral studio lighting", lens: "50mm portrait lens" }),
    });
  }

  for (const wardrobe of wardrobes) {
    const task = { framing: "full-body standing three-quarter pose, head-to-toe visible" };
    jobs.push({
      id: `${profile.id}/wardrobe/${slug(wardrobe)}`,
      category: "wardrobe",
      taskId: slug(wardrobe),
      label: wardrobe,
      required: true,
      wardrobe,
      prompt: buildPrompt({ profile, medium, task, wardrobe, expression: "neutral", lighting: "neutral studio lighting", lens: "50mm lens" }),
    });
  }

  for (const test of CONTINUITY_TESTS) {
    const task = { framing: "head-and-shoulders three-quarter portrait" };
    jobs.push({
      id: `${profile.id}/continuity/${test.id}`,
      category: "continuity",
      taskId: test.id,
      label: test.label,
      required: true,
      wardrobe: wardrobes[0],
      prompt: buildPrompt({ profile, medium, task, wardrobe: wardrobes[0], expression: "neutral", lighting: test.lighting, lens: test.lens }),
    });
  }

  return {
    schema: "fpai.character-factory.plan.v1",
    version: CHARACTER_FACTORY_VERSION,
    createdAt: new Date().toISOString(),
    character: profile,
    medium,
    mediumLabel: MEDIUM_PRESETS[medium].label,
    jobs,
    totals: {
      jobs: jobs.length,
      angles: jobs.filter((job) => job.category === "angle").length,
      expressions: jobs.filter((job) => job.category === "expression").length,
      wardrobe: jobs.filter((job) => job.category === "wardrobe").length,
      continuity: jobs.filter((job) => job.category === "continuity").length,
    },
    outputLayout: {
      root: profile.id,
      accepted: ["identity", "angles", "expressions", "full_body", "wardrobe", "continuity_tests"],
      rejected: "rejected",
      characterManifest: "character.json",
      benchmarkManifest: "manifest.json",
    },
  };
}

export function scoreCharacterResult(metrics = {}) {
  const weights = {
    identity: 0.4,
    anatomy: 0.2,
    framing: 0.15,
    wardrobe: 0.1,
    artifactFree: 0.15,
  };
  const normalized = {};
  for (const key of Object.keys(weights)) {
    const value = Number(metrics[key]);
    normalized[key] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }
  const score = Object.entries(weights).reduce((sum, [key, weight]) => sum + normalized[key] * weight, 0);
  return { score: Number(score.toFixed(4)), metrics: normalized, pass: score >= 0.82 && normalized.identity >= 0.85 && normalized.anatomy >= 0.8 };
}

export function createBenchmarkReport(plan, attempts = []) {
  if (!plan?.jobs) throw new Error("A Character Factory plan is required.");
  const byJob = new Map();
  for (const attempt of attempts) {
    const current = byJob.get(attempt.jobId) || [];
    current.push(attempt);
    byJob.set(attempt.jobId, current);
  }

  const results = plan.jobs.map((job) => {
    const jobAttempts = byJob.get(job.id) || [];
    const accepted = jobAttempts.find((attempt) => attempt.accepted || attempt.score?.pass) || null;
    return {
      jobId: job.id,
      category: job.category,
      attempts: jobAttempts.length,
      accepted: Boolean(accepted),
      acceptedAsset: accepted?.asset || null,
      bestScore: jobAttempts.reduce((max, attempt) => Math.max(max, Number(attempt.score?.score || 0)), 0),
      computeSeconds: jobAttempts.reduce((sum, attempt) => sum + Number(attempt.computeSeconds || 0), 0),
      costUsd: jobAttempts.reduce((sum, attempt) => sum + Number(attempt.costUsd || 0), 0),
    };
  });

  const required = results.filter((result) => plan.jobs.find((job) => job.id === result.jobId)?.required !== false);
  const acceptedCount = required.filter((result) => result.accepted).length;
  const totalAttempts = results.reduce((sum, result) => sum + result.attempts, 0);
  const computeSeconds = results.reduce((sum, result) => sum + result.computeSeconds, 0);
  const costUsd = results.reduce((sum, result) => sum + result.costUsd, 0);
  const acceptanceRate = required.length ? acceptedCount / required.length : 0;
  const firstPassCount = required.filter((result) => result.accepted && result.attempts === 1).length;
  const firstPassRate = required.length ? firstPassCount / required.length : 0;

  return {
    schema: "fpai.character-factory.benchmark.v1",
    characterId: plan.character.id,
    medium: plan.medium,
    requiredJobs: required.length,
    acceptedJobs: acceptedCount,
    acceptanceRate: Number(acceptanceRate.toFixed(4)),
    firstPassRate: Number(firstPassRate.toFixed(4)),
    totalAttempts,
    rejectCount: Math.max(0, totalAttempts - acceptedCount),
    computeSeconds: Number(computeSeconds.toFixed(2)),
    costUsd: Number(costUsd.toFixed(4)),
    costPerAcceptedAsset: acceptedCount ? Number((costUsd / acceptedCount).toFixed(4)) : null,
    ready: acceptanceRate === 1 && firstPassRate >= 0.7,
    results,
  };
}
