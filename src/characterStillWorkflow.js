import {
  CHARACTER_STILL_APPLY_WEIGHT,
  CHARACTER_STILL_CHECKPOINT,
  CHARACTER_STILL_COMBINE_METHOD,
  CHARACTER_STILL_DEFAULT_CFG,
  CHARACTER_STILL_DEFAULT_HEIGHT,
  CHARACTER_STILL_DEFAULT_NEGATIVE_PROMPT,
  CHARACTER_STILL_DEFAULT_STEPS,
  CHARACTER_STILL_DEFAULT_WIDTH,
  CHARACTER_STILL_IPADAPTER_PRESET,
  CHARACTER_STILL_SAMPLER,
  CHARACTER_STILL_SCHEDULER,
  CHARACTER_STILL_STACK_ID,
  resolveCharacterStillSeed,
  roundLatentDimension,
  selectIdentityReferences,
} from "./characterStillStack.js";

function addNode(nodes, classType, inputs, title) {
  const id = String(Object.keys(nodes).length + 1);
  nodes[id] = {
    class_type: classType,
    inputs,
    _meta: { title: title || classType },
  };
  return id;
}

function combineEmbeds(nodes, embeds, method = CHARACTER_STILL_COMBINE_METHOD) {
  if (embeds.length === 1) return embeds[0];
  const remaining = [...embeds];
  let current = null;
  while (remaining.length) {
    const batch = current ? [current, ...remaining.splice(0, 4)] : remaining.splice(0, 5);
    if (batch.length === 1) {
      current = batch[0];
      break;
    }
    const inputs = { method };
    batch.forEach((embed, index) => {
      inputs[`embed${index + 1}`] = embed;
    });
    current = [addNode(nodes, "IPAdapterCombineEmbeds", inputs, "Combine identity embeds"), 0];
  }
  return current;
}

/**
 * Build a native ComfyUI API-format graph owned by Film Studio.
 * LoadImage nodes consume filenames from POST /upload/image (fpai/<name>.png).
 */
export function buildCharacterStillWorkflow({
  prompt,
  negativePrompt = CHARACTER_STILL_DEFAULT_NEGATIVE_PROMPT,
  seed = -1,
  width = CHARACTER_STILL_DEFAULT_WIDTH,
  height = CHARACTER_STILL_DEFAULT_HEIGHT,
  steps = CHARACTER_STILL_DEFAULT_STEPS,
  cfg = CHARACTER_STILL_DEFAULT_CFG,
  filenamePrefix = "fpai-character",
  references = [],
  checkpoint = CHARACTER_STILL_CHECKPOINT,
  placeholders = false,
} = {}) {
  const text = String(prompt || "").trim();
  if (!placeholders && !text) throw new Error("Character prompt is required.");

  const nodes = {};
  const ckpt = addNode(
    nodes,
    "CheckpointLoaderSimple",
    { ckpt_name: checkpoint },
    "Load RealVisXL V5.0",
  );
  const positive = addNode(
    nodes,
    "CLIPTextEncode",
    { text: placeholders ? "__FPAI_PROMPT__" : text, clip: [ckpt, 1] },
    "Positive prompt",
  );
  const negative = addNode(
    nodes,
    "CLIPTextEncode",
    {
      text: placeholders ? "__FPAI_NEGATIVE_PROMPT__" : String(negativePrompt || CHARACTER_STILL_DEFAULT_NEGATIVE_PROMPT),
      clip: [ckpt, 1],
    },
    "Negative prompt",
  );
  const latent = addNode(
    nodes,
    "EmptyLatentImage",
    {
      width: placeholders ? "__FPAI_WIDTH__" : roundLatentDimension(width, CHARACTER_STILL_DEFAULT_WIDTH),
      height: placeholders ? "__FPAI_HEIGHT__" : roundLatentDimension(height, CHARACTER_STILL_DEFAULT_HEIGHT),
      batch_size: 1,
    },
    "Empty latent",
  );

  const selected = selectIdentityReferences(references);
  let modelRef = [ckpt, 0];

  if (selected.length) {
    const loader = addNode(
      nodes,
      "IPAdapterUnifiedLoader",
      { model: modelRef, preset: CHARACTER_STILL_IPADAPTER_PRESET },
      "Load IPAdapter Plus SDXL",
    );
    modelRef = [loader, 0];
    const posEmbeds = selected.map((ref, index) => {
      const filename = placeholders
        ? `__FPAI_REFERENCE_${index + 1}__`
        : String(ref.filename || ref.image || "").trim();
      if (!filename) throw new Error("Each identity reference must include a Comfy LoadImage filename.");
      const loaded = addNode(
        nodes,
        "LoadImage",
        { image: filename },
        `Reference ${index + 1} (${ref.category || "other"})`,
      );
      const prepared = addNode(
        nodes,
        "PrepImageForClipVision",
        {
          image: [loaded, 0],
          interpolation: "LANCZOS",
          crop_position: "center",
          sharpening: 0,
        },
        `Prep reference ${index + 1}`,
      );
      const encoded = addNode(
        nodes,
        "IPAdapterEncoder",
        {
          ipadapter: [loader, 1],
          image: [prepared, 0],
          weight: ref.weight,
        },
        `Encode reference ${index + 1}`,
      );
      return [encoded, 0];
    });
    const combined = combineEmbeds(nodes, posEmbeds);
    const applied = addNode(
      nodes,
      "IPAdapterEmbeds",
      {
        model: modelRef,
        ipadapter: [loader, 1],
        pos_embed: combined,
        weight: CHARACTER_STILL_APPLY_WEIGHT,
        weight_type: "linear",
        start_at: 0,
        end_at: 1,
      },
      "Apply combined identity",
    );
    modelRef = [applied, 0];
  }

  const sampler = addNode(
    nodes,
    "KSampler",
    {
      seed: placeholders ? "__FPAI_SEED__" : resolveCharacterStillSeed(seed),
      steps: placeholders ? "__FPAI_STEPS__" : Math.max(1, Math.round(Number(steps) || CHARACTER_STILL_DEFAULT_STEPS)),
      cfg: placeholders ? "__FPAI_CFG__" : Number(cfg) || CHARACTER_STILL_DEFAULT_CFG,
      sampler_name: CHARACTER_STILL_SAMPLER,
      scheduler: CHARACTER_STILL_SCHEDULER,
      denoise: 1,
      model: modelRef,
      positive: [positive, 0],
      negative: [negative, 0],
      latent_image: [latent, 0],
    },
    "KSampler",
  );
  const decoded = addNode(
    nodes,
    "VAEDecode",
    { samples: [sampler, 0], vae: [ckpt, 2] },
    "VAE decode",
  );
  addNode(
    nodes,
    "SaveImage",
    {
      filename_prefix: placeholders ? "__FPAI_FILENAME_PREFIX__" : String(filenamePrefix || "fpai-character"),
      images: [decoded, 0],
    },
    "Save character still",
  );

  return nodes;
}

export function characterStillWorkflowClassTypes(referenceCount = 1) {
  const workflow = buildCharacterStillWorkflow({
    prompt: "placeholder",
    placeholders: true,
    references: Array.from({ length: Math.max(0, referenceCount) }, (_, index) => ({
      filename: `__FPAI_REFERENCE_${index + 1}__`,
      category: index === 0 ? "identity_anchor" : "other",
    })),
  });
  return [...new Set(Object.values(workflow).map((node) => node.class_type))];
}

export function describeCharacterStillWorkflow(workflow) {
  const nodes = Object.values(workflow || {});
  return {
    stackId: CHARACTER_STILL_STACK_ID,
    nodeCount: nodes.length,
    classTypes: [...new Set(nodes.map((node) => node.class_type))],
    checkpoint: nodes.find((node) => node.class_type === "CheckpointLoaderSimple")?.inputs?.ckpt_name || null,
    referenceCount: nodes.filter((node) => node.class_type === "LoadImage").length,
    identityEnabled: nodes.some((node) => node.class_type === "IPAdapterEmbeds"),
    hasSaveImage: nodes.some((node) => node.class_type === "SaveImage"),
  };
}
