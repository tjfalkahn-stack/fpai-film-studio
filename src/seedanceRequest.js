import { estimateSeedanceCost } from "./seedancePricing.js";

export const SEEDANCE_QUEUE_ORIGIN = "https://queue.fal.run";

export const SEEDANCE_ENDPOINTS = Object.freeze({
  fast: Object.freeze({
    "text-to-video": "bytedance/seedance-2.0/fast/text-to-video",
    "image-to-video": "bytedance/seedance-2.0/fast/image-to-video",
    "reference-to-video": "bytedance/seedance-2.0/fast/reference-to-video",
  }),
  standard: Object.freeze({
    "text-to-video": "bytedance/seedance-2.0/text-to-video",
    "image-to-video": "bytedance/seedance-2.0/image-to-video",
    "reference-to-video": "bytedance/seedance-2.0/reference-to-video",
  }),
});

export const SEEDANCE_ENDPOINT_IDS = Object.freeze(
  Object.values(SEEDANCE_ENDPOINTS).flatMap((tier) => Object.values(tier)),
);

export const SEEDANCE_DURATIONS = Object.freeze([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
export const SEEDANCE_ASPECT_RATIOS = Object.freeze(["16:9", "9:16", "21:9", "4:3", "1:1", "3:4"]);
export const SEEDANCE_FAST_RESOLUTIONS = Object.freeze(["720p"]);
export const SEEDANCE_STANDARD_RESOLUTIONS = Object.freeze(["720p", "1080p"]);
export const SEEDANCE_MAX_REFERENCE_IMAGES = 9;
export const SEEDANCE_MAX_REFERENCE_VIDEOS = 3;

export const CHARACTER_BIBLE = Object.freeze({
  marcus: {
    id: "marcus",
    name: 'Marcus "Kingpin" Holloway',
    shortName: "Marcus",
    role: "Kingpin / protagonist",
    wardrobe: "Tarmac Look 01",
  },
  jasmine: {
    id: "jasmine",
    name: "Jasmine",
    shortName: "Jasmine",
    role: "Marcus's woman / secret architect",
    wardrobe: "Tarmac Look 01",
  },
  turner: {
    id: "turner",
    name: "Detective Turner",
    shortName: "Turner",
    role: "Dirty cop / hidden accomplice",
    wardrobe: "HPD Look 01",
  },
  mikey: {
    id: "mikey",
    name: "Mikey",
    shortName: "Mikey",
    role: "Marcus & Jasmine's young son",
    wardrobe: "Pajamas 01",
  },
});

export function seedanceTier(providerOrTier) {
  const value = String(providerOrTier || "");
  if (value === "standard" || value === "seedance-standard" || value.startsWith("seedance-standard")) {
    return "standard";
  }
  return "fast";
}

export function isSeedanceProvider(id) {
  return String(id || "").startsWith("seedance-");
}

export function toDataUri(ref) {
  if (!ref) return null;
  if (typeof ref === "string") return ref;
  if (typeof ref.url === "string" && ref.url) return ref.url;
  if (typeof ref.data === "string" && ref.data) {
    const mime = ref.mimeType || "image/png";
    if (ref.data.startsWith("data:")) return ref.data;
    return `data:${mime};base64,${ref.data}`;
  }
  return null;
}

function asList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

export function collectSeedanceMedia(input = {}) {
  const images = asList(input.referenceImages).map((ref, index) => ({
    ...ref,
    role: ref.role || (ref.characterId ? "character" : "reference"),
    order: index + 1,
  }));
  const environment = asList(input.environmentReferences || input.sceneReferenceImages).map((ref) => ({
    ...ref,
    role: ref.role || "environment",
  }));
  const combined = [...images, ...environment];
  const endFrame =
    input.endFrameImage ||
    input.endImage ||
    combined.find((ref) => ref.role === "end-frame" || ref.role === "endFrame") ||
    null;
  const frames = combined.filter((ref) => ref !== endFrame && ref.role !== "end-frame" && ref.role !== "endFrame");
  const videos = asList(input.referenceVideos || input.referenceVideo);
  return { images: frames, environment, endFrame, videos, allImages: combined };
}

export function selectSeedanceMode(media) {
  if (media.videos.length || media.images.length > 1) return "reference-to-video";
  if (media.images.length === 1) return "image-to-video";
  return "text-to-video";
}

export function seedanceEndpointId(tier, mode) {
  const table = SEEDANCE_ENDPOINTS[tier];
  return table?.[mode] || null;
}

function characterLabel(ref) {
  if (ref.role === "environment") {
    return `${ref.name || "the scene environment"} (scene / environment reference)`;
  }
  const bible = CHARACTER_BIBLE[ref.characterId];
  const name = bible?.shortName || ref.name || ref.characterId || "reference figure";
  const role = bible?.role || ref.roleLabel;
  const category = ref.category ? String(ref.category).replace(/-/g, " ") : "";
  const expression = ref.expression ? `${ref.expression} expression` : "";
  const parts = [name];
  if (role) parts.push(`(${role})`);
  if (category) parts.push(category);
  if (expression) parts.push(expression);
  return parts.filter(Boolean).join(" · ");
}

export function annotateSeedancePrompt(prompt, media) {
  const lines = [];
  media.images.forEach((ref, index) => {
    lines.push(`@Image${index + 1} is ${characterLabel(ref)}. Keep identity locked to this reference.`);
  });
  media.videos.forEach((ref, index) => {
    const label = ref.label || ref.name || "motion / staging reference";
    lines.push(`@Video${index + 1} is ${label}. Use it for motion and coverage, not a new identity.`);
  });
  if (media.endFrame) {
    lines.push("End on the supplied last-frame reference.");
  }
  const tagged = lines.length ? `${lines.join(" ")} ${prompt}`.trim() : prompt;
  return tagged;
}

function optionalSeed(input) {
  if (input.seed == null || input.seed === "") return undefined;
  const seed = Number(input.seed);
  if (!Number.isInteger(seed)) {
    const error = new Error("Seed must be an integer when provided.");
    error.code = "INVALID_INPUT";
    error.httpStatus = 400;
    throw error;
  }
  return seed;
}

export function buildSeedanceRequest(input = {}, env = {}) {
  const tier = seedanceTier(input.tier || input.provider);
  const media = collectSeedanceMedia(input);
  const mode = selectSeedanceMode(media);
  const endpointId = seedanceEndpointId(tier, mode);
  if (!endpointId) {
    const error = new Error("Unsupported Seedance endpoint.");
    error.code = "UNSUPPORTED_INPUT";
    error.httpStatus = 400;
    throw error;
  }
  if (media.images.length > SEEDANCE_MAX_REFERENCE_IMAGES) {
    const error = new Error(`Seedance accepts at most ${SEEDANCE_MAX_REFERENCE_IMAGES} reference images.`);
    error.code = "INVALID_REFERENCES";
    error.httpStatus = 400;
    throw error;
  }
  if (media.videos.length > SEEDANCE_MAX_REFERENCE_VIDEOS) {
    const error = new Error(`Seedance accepts at most ${SEEDANCE_MAX_REFERENCE_VIDEOS} reference videos.`);
    error.code = "INVALID_REFERENCES";
    error.httpStatus = 400;
    throw error;
  }

  const generateAudio = input.generateAudio ?? input.generate_audio;
  const audio = generateAudio !== false;
  const prompt = annotateSeedancePrompt(String(input.prompt || "").trim(), media);
  const body = {
    prompt,
    duration: String(input.duration),
    resolution: input.resolution,
    aspect_ratio: input.aspectRatio || input.aspect_ratio || "16:9",
    generate_audio: audio,
  };
  if (input.bitrateMode || input.bitrate_mode) {
    body.bitrate_mode = input.bitrateMode || input.bitrate_mode;
  }
  const seed = optionalSeed(input);
  if (seed != null) body.seed = seed;
  if (input.projectId) body.end_user_id = String(input.projectId);

  if (mode === "image-to-video") {
    const imageUrl = toDataUri(media.images[0]);
    if (!imageUrl) {
      const error = new Error("Image-to-video requires a start-frame image.");
      error.code = "INVALID_REFERENCES";
      error.httpStatus = 400;
      throw error;
    }
    body.image_url = imageUrl;
    const endUrl = toDataUri(media.endFrame);
    if (endUrl) body.end_image_url = endUrl;
  }

  if (mode === "reference-to-video") {
    const imageUrls = media.images.map(toDataUri).filter(Boolean);
    const videoUrls = media.videos.map(toDataUri).filter(Boolean);
    if (!imageUrls.length && !videoUrls.length) {
      const error = new Error("Reference-to-video requires at least one image or video reference.");
      error.code = "INVALID_REFERENCES";
      error.httpStatus = 400;
      throw error;
    }
    if (imageUrls.length) body.image_urls = imageUrls;
    if (videoUrls.length) body.video_urls = videoUrls;
  }

  const quote = estimateSeedanceCost(
    {
      ...input,
      tier,
      referenceVideos: media.videos,
    },
    env,
  );

  return {
    tier,
    mode,
    endpointId,
    body,
    media,
    audio,
    referenceCount: media.images.length,
    hasEndFrame: Boolean(media.endFrame),
    hasReferenceVideo: media.videos.length > 0,
    quote,
  };
}

export function seedanceSelectionRationale(input, built) {
  const reasons = [];
  if (built.mode === "text-to-video") reasons.push("No image or video references; text-to-video endpoint.");
  if (built.mode === "image-to-video") {
    reasons.push(
      built.hasEndFrame
        ? "Single start frame plus end frame; image-to-video endpoint."
        : "Single image reference; image-to-video endpoint.",
    );
  }
  if (built.mode === "reference-to-video") {
    reasons.push(
      built.hasReferenceVideo
        ? "Reference video present; reference-to-video endpoint."
        : "Multiple Character Bible / scene references; reference-to-video endpoint.",
    );
  }
  if (built.tier === "fast") reasons.push("Fast tier for inexpensive draft motion and coverage tests.");
  if (built.tier === "standard") reasons.push("Standard tier for cinematic character / audio-enabled shots.");
  if (input.selectionReason) reasons.push(input.selectionReason);
  return reasons.join(" ");
}
