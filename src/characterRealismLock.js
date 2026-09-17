export const CHARACTER_REALISM_LOCK_ID = "fpai.character-realism-lock.v2";
export const CHARACTER_REALISM_LOCK_VERSION = "2.0.0";

const CHARACTER_REALISM_LOCKED_MEDIA = new Set(["cinematic", "vintage"]);

export const CHARACTER_REALISM_POSITIVE_PROMPT = [
  "a highly realistic live-action photograph of a real human being, captured in camera",
  "grounded documentary and editorial photography rather than character art",
  "natural unretouched skin with visible pores, fine facial hair, subtle tonal variation, normal human asymmetry, realistic under-eye texture, and age-appropriate detail",
  "physically plausible light falloff, shadows, reflections, and catchlights",
  "neutral color science with restrained contrast and saturation",
  "authentic hair, fabric, and material texture",
  "believable full-frame photographic optics with natural depth of field, focus transition, and very fine restrained grain",
  "honest, unstylized, production-reference photography",
].join(", ");

export const CHARACTER_IDENTITY_LOCK_PROMPT = [
  "IDENTITY LOCK: Treat the highest-ranked primary identity anchor as the sole authority for the face and likeness.",
  "Preserve the exact facial geometry, eye shape and spacing, nose, lips, jawline, ears, hairline, skin tone, distinguishing marks, apparent age, and body proportions.",
  "Supporting references may inform only the requested angle, expression, body view, wardrobe, or pose; never average, blend, beautify, or reinterpret the identity.",
  "The result must unmistakably depict the same person as the primary identity anchor.",
].join(" ");

export const CHARACTER_REALISM_PROMPT_CONTRACT = [
  `${CHARACTER_REALISM_POSITIVE_PROMPT}.`,
  CHARACTER_IDENTITY_LOCK_PROMPT,
].join(" ");

export const CHARACTER_REALISM_NEGATIVE_PROMPT = [
  "animation, anime, cartoon, comic, illustration, painterly, concept art",
  "3d, cgi, computer graphics, video game, game engine, unreal engine, octane render, digital human",
  "doll, mannequin, plastic skin, wax skin, porcelain skin, airbrushed skin, beauty retouching, over-smoothed skin",
  "fake pores, hyper-sharpened skin, excessive clarity, hdr, tone mapping, oversaturated, teal and orange grade",
  "glamour lighting, movie poster, uncanny valley, synthetic face",
  "identity drift, face morph, blended identity, different person, changed age, changed ethnicity",
  "text, watermark, logo, signature, collage, contact sheet, split screen",
  "duplicate person, extra person, extra limbs, extra fingers, bad hands, bad anatomy",
  "deformed eyes, deformed mouth, distorted face, cropped feet",
  "lowres, blurry, oversharpened, jpeg artifacts",
].join(", ");

export const CHARACTER_REALISM_LOCK = Object.freeze({
  id: CHARACTER_REALISM_LOCK_ID,
  version: CHARACTER_REALISM_LOCK_VERSION,
  benchmark: "Jasmine",
  appliesTo: "photoreal live-action character creation",
  positivePrompt: CHARACTER_REALISM_POSITIVE_PROMPT,
  identityPrompt: CHARACTER_IDENTITY_LOCK_PROMPT,
  negativePrompt: CHARACTER_REALISM_NEGATIVE_PROMPT,
  requirements: Object.freeze({
    standaloneNativeResolutionImages: true,
    primaryIdentityAnchorRequired: true,
    referenceAwareQc: true,
    minimumPhotographicRealismScore: 0.9,
    minimumIdentityScore: 0.9,
  }),
});

export function mergeCharacterNegativePrompts(...prompts) {
  const seen = new Set();
  const terms = [];
  for (const prompt of prompts) {
    for (const raw of String(prompt || "").split(",")) {
      const term = raw.trim();
      const key = term.toLowerCase();
      if (!term || seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
  }
  return terms.join(", ");
}

export function applyCharacterRealismPrompt(prompt) {
  const requested = String(prompt || "").trim();
  const lower = requested.toLowerCase();
  const required = [];
  if (!lower.includes(CHARACTER_REALISM_POSITIVE_PROMPT.toLowerCase())) {
    required.push(`${CHARACTER_REALISM_POSITIVE_PROMPT}.`);
  }
  if (!lower.includes(CHARACTER_IDENTITY_LOCK_PROMPT.toLowerCase())) {
    required.push(CHARACTER_IDENTITY_LOCK_PROMPT);
  }
  if (requested) required.push(requested);
  return required.join(" ");
}

export function isCharacterRealismLockedMedium(medium) {
  return CHARACTER_REALISM_LOCKED_MEDIA.has(String(medium || "cinematic").trim().toLowerCase());
}

export function hasCurrentCharacterRealismLock(lock) {
  return Boolean(
    lock?.applied === true &&
    lock.id === CHARACTER_REALISM_LOCK_ID &&
    lock.version === CHARACTER_REALISM_LOCK_VERSION,
  );
}

export function characterRealismLockManifest({ applied = true } = {}) {
  return {
    id: CHARACTER_REALISM_LOCK.id,
    version: CHARACTER_REALISM_LOCK.version,
    benchmark: CHARACTER_REALISM_LOCK.benchmark,
    applied: Boolean(applied),
    requirements: { ...CHARACTER_REALISM_LOCK.requirements },
  };
}
