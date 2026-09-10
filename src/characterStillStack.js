/**
 * FPAI photoreal character still stack for native ComfyUI on 24GB VRAM.
 *
 * Selected for cinematic human stills (Marcus, Jasmine, Turner, Mikey):
 * RealVisXL V5.0 (photoreal skin / lighting) + IPAdapter Plus SDXL
 * (multi-reference identity). Flux was considered and rejected for this
 * 24GB MIG footprint so CLIP-vision identity adapters have headroom.
 *
 * This module is Worker-safe (no filesystem). Download URLs and sizes are
 * duplicated in deploy/runpod-comfyui/models.manifest.json for Pod bootstrap.
 */

export const CHARACTER_STILL_STACK_ID = "fpai-character-still-photoreal-sdxl-v1";
export const CHARACTER_STILL_STACK_LABEL = "FPAI Photoreal Character Still · RealVisXL V5.0 + IPAdapter Plus";
export const CHARACTER_STILL_MAX_REFERENCES = 8;

export const CHARACTER_STILL_CHECKPOINT = "RealVisXL_V5.0_fp16.safetensors";
export const CHARACTER_STILL_CLIP_VISION = "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors";
export const CHARACTER_STILL_IPADAPTER = "ip-adapter-plus_sdxl_vit-h.safetensors";
export const CHARACTER_STILL_VAE_NOTE =
  "VAE is baked into RealVisXL V5.0; CheckpointLoaderSimple output 2 is used. No separate VAE file is required.";

export const CHARACTER_STILL_IPADAPTER_PRESET = "PLUS (high strength)";
export const CHARACTER_STILL_SAMPLER = "dpmpp_2m";
export const CHARACTER_STILL_SCHEDULER = "karras";
export const CHARACTER_STILL_DEFAULT_STEPS = 30;
export const CHARACTER_STILL_DEFAULT_CFG = 6;
export const CHARACTER_STILL_DEFAULT_WIDTH = 1024;
export const CHARACTER_STILL_DEFAULT_HEIGHT = 1024;
export const CHARACTER_STILL_APPLY_WEIGHT = 0.85;
export const CHARACTER_STILL_COMBINE_METHOD = "norm average";

export const CHARACTER_STILL_DEFAULT_NEGATIVE_PROMPT = [
  "cartoon, anime, illustration, cgi, 3d render, plastic skin, wax skin",
  "text, watermark, logo, signature, collage, contact sheet, split screen",
  "duplicate person, extra person, extra limbs, extra fingers, deformed anatomy",
  "cropped feet, mutated hands, distorted face, identity mix, different person",
  "lowres, blurry, oversharpened, oversaturated, jpeg artifacts",
].join(", ");

export const CHARACTER_STILL_CUSTOM_NODES = Object.freeze([
  {
    id: "ComfyUI_IPAdapter_plus",
    repo: "https://github.com/cubiq/ComfyUI_IPAdapter_plus.git",
    requiredClasses: [
      "IPAdapterUnifiedLoader",
      "IPAdapterEncoder",
      "IPAdapterCombineEmbeds",
      "IPAdapterEmbeds",
      "PrepImageForClipVision",
    ],
  },
]);

export const CHARACTER_STILL_CORE_CLASSES = Object.freeze([
  "CheckpointLoaderSimple",
  "CLIPTextEncode",
  "EmptyLatentImage",
  "KSampler",
  "VAEDecode",
  "SaveImage",
  "LoadImage",
  "CLIPVisionLoader",
]);

export const IDENTITY_REFERENCE_WEIGHTS = Object.freeze({
  identity_anchor: 1,
  face_closeup: 0.92,
  front: 0.88,
  three_quarter: 0.72,
  profile: 0.68,
  full_body: 0.58,
  wardrobe: 0.48,
  expression: 0.42,
  action_pose: 0.38,
  other: 0.32,
});

export const CHARACTER_STILL_MODELS = Object.freeze([
  {
    id: "checkpoint",
    role: "checkpoint",
    filename: CHARACTER_STILL_CHECKPOINT,
    directory: "checkpoints",
    source: "Hugging Face SG161222/RealVisXL_V5.0",
    url: "https://huggingface.co/SG161222/RealVisXL_V5.0/resolve/main/RealVisXL_V5.0_fp16.safetensors",
    approxBytes: 6938076410,
    minBytes: 6000000000,
    approxGiB: 6.46,
  },
  {
    id: "clip_vision",
    role: "clip_vision",
    filename: CHARACTER_STILL_CLIP_VISION,
    directory: "clip_vision",
    source: "Hugging Face h94/IP-Adapter (SDXL image encoder, renamed)",
    url: "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/image_encoder/model.safetensors",
    approxBytes: 2528373898,
    minBytes: 2000000000,
    approxGiB: 2.35,
  },
  {
    id: "ipadapter",
    role: "ipadapter",
    filename: CHARACTER_STILL_IPADAPTER,
    directory: "ipadapter",
    source: "Hugging Face h94/IP-Adapter",
    url: "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors",
    approxBytes: 847517560,
    minBytes: 700000000,
    approxGiB: 0.79,
  },
]);

export const CHARACTER_STILL_DISK_FOOTPRINT = Object.freeze({
  modelsApproxBytes: CHARACTER_STILL_MODELS.reduce((sum, model) => sum + model.approxBytes, 0),
  modelsApproxGiB: Number(
    (
      CHARACTER_STILL_MODELS.reduce((sum, model) => sum + model.approxBytes, 0) /
      1024 /
      1024 /
      1024
    ).toFixed(2),
  ),
  customNodesApproxMiB: 20,
  recommendedFreeGiB: 12,
});

export function weightForReferenceCategory(category) {
  return IDENTITY_REFERENCE_WEIGHTS[String(category || "").trim()] || IDENTITY_REFERENCE_WEIGHTS.other;
}

export function roundLatentDimension(value, fallback) {
  const n = Number(value);
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.max(64, Math.round(base / 8) * 8);
}

export function resolveCharacterStillSeed(seed) {
  const n = Number(seed);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return Math.floor(Math.random() * 0x7fffffff);
}

export function selectIdentityReferences(references = [], max = CHARACTER_STILL_MAX_REFERENCES) {
  const ranked = (Array.isArray(references) ? references : []).map((ref, index) => ({
    ...ref,
    index,
    category: ref?.category || ref?.role || "other",
    weight: Number(ref?.weight) > 0 ? Number(ref.weight) : weightForReferenceCategory(ref?.category || ref?.role),
  }));
  ranked.sort((a, b) => b.weight - a.weight || a.index - b.index);
  return ranked.slice(0, Math.max(0, max));
}
