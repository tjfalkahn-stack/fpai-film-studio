export const DRAW_THINGS_LOCAL_PROVIDER_ID = "draw-things-local";
export const DRAW_THINGS_MODEL = "Realistic Vision v5.1 (8-bit)";

const line = (label, value) => (value ? `${label}: ${value}` : "");

export function buildDrawThingsPrompt({
  project,
  scene,
  shot,
  plan,
  characters = [],
  aspectRatio,
}) {
  const cast = characters
    .map((character) =>
      [
        character.name,
        character.wardrobe && `wardrobe ${character.wardrobe}`,
        character.notes,
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .join("; ");
  return [
    `Photorealistic cinematic ${aspectRatio} still frame for ${project.title}.`,
    line("Scene", scene?.title || shot.scene),
    line("Shot", `${shot.id} · ${shot.subject}`),
    line("Camera", shot.move),
    line("Cast and wardrobe continuity", cast),
    line("Production prompt", plan.prompt),
    "Preserve the imported reference identity, apparent age, face, skin tone, hair, body proportions, and wardrobe.",
    "Live-action feature-film frame, grounded crime-thriller realism, natural skin and fabric, cinematic lighting, coherent anatomy, sharp eyes, subtle film grain.",
    "Keep the action fictional and the depicted cast adult. Do not add text, captions, logos, or watermarks.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildDrawThingsNegativePrompt() {
  return [
    "cartoon, anime, illustration, game render, CGI, plastic skin, over-smoothed skin",
    "low resolution, blurry face, malformed hands, extra fingers, duplicate limbs, extra people",
    "changed identity, changed wardrobe, child, minor, text, caption, logo, watermark",
  ].join(", ");
}

export function buildDrawThingsHandoff({
  project,
  scene,
  shot,
  plan,
  characters = [],
  resolution,
  aspectRatio,
  referenceSelection,
  localReferences = [],
  generatedAt = new Date().toISOString(),
}) {
  return {
    version: 1,
    provider: DRAW_THINGS_LOCAL_PROVIDER_ID,
    localApplication: "Draw Things",
    modelRecommendation: DRAW_THINGS_MODEL,
    generatedAt,
    project: { id: project.id, title: project.title },
    scene: { id: shot.scene, title: scene?.title || "" },
    shot: {
      id: shot.id,
      subject: shot.subject,
      camera: shot.move,
      finalEditSeconds: shot.sec,
    },
    requestedOutput: { mediaType: "image", resolution, aspectRatio },
    characters: characters.map((character) => ({
      id: character.id,
      name: character.name,
      wardrobe: character.wardrobe || "",
      continuityNotes: character.notes || "",
    })),
    references: (referenceSelection?.selected || []).map((item) => ({
      assetId: item.assetId,
      characterId: item.characterId,
      order: item.order,
      reasons: item.reasons || [],
      instruction:
        item.order === 1
          ? "Use as the primary image-to-image identity reference."
          : "Use as a supporting identity or wardrobe reference.",
    })),
    localReferences: localReferences.map((item) => ({
      key: item.key,
      label: item.label,
      instruction: "Import into Draw Things as an image-to-image reference.",
    })),
    prompt: buildDrawThingsPrompt({
      project,
      scene,
      shot,
      plan,
      characters,
      aspectRatio,
    }),
    negativePrompt: buildDrawThingsNegativePrompt(),
    recommendedSettings: {
      cloudCompute: false,
      steps: 28,
      guidanceScale: 6,
      imageStrength: 0.4,
      batchSize: 1,
    },
    returnStep:
      "Save the approved PNG or JPEG, return to this Shot Editor, and use Upload completed take.",
  };
}

export function drawThingsHandoffFilename(projectId, shotId) {
  const safe = (value) =>
    String(value || "shot")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "shot";
  return `${safe(projectId)}-shot-${safe(shotId)}-draw-things-handoff.json`;
}
