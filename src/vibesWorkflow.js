export const VIBES_MANUAL_PROVIDER_ID = "vibes-manual";
export const VIBES_URL = "https://vibes.ai/";

const line = (label, value) => (value ? `${label}: ${value}` : "");

export function buildVibesPrompt({
  project,
  scene,
  shot,
  plan,
  characters = [],
  duration,
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
    `Create a ${duration}-second cinematic ${aspectRatio} video shot for ${project.title}.`,
    line("Scene", scene?.title || shot.scene),
    line("Shot", `${shot.id} · ${shot.subject}`),
    line("Camera", shot.move),
    line("Cast continuity", cast),
    line("Production prompt", plan.prompt),
    "Preserve the uploaded reference identity, apparent age, face, skin tone, hair, body proportions, and wardrobe. Keep the same person throughout the shot.",
    "Use natural live-action motion, realistic skin and fabric, cinematic lighting, coherent hands and eyes, and stable facial identity. Avoid a cartoon, game-rendered, plastic, or over-smoothed look.",
    "Do not add text, captions, logos, watermarks, extra people, duplicate limbs, or wardrobe changes.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildVibesHandoff({
  project,
  scene,
  shot,
  plan,
  characters = [],
  duration,
  resolution,
  aspectRatio,
  referenceSelection,
  localReferences = [],
  generatedAt = new Date().toISOString(),
}) {
  return {
    version: 1,
    provider: VIBES_MANUAL_PROVIDER_ID,
    destination: VIBES_URL,
    generatedAt,
    project: { id: project.id, title: project.title },
    scene: { id: shot.scene, title: scene?.title || "" },
    shot: {
      id: shot.id,
      subject: shot.subject,
      camera: shot.move,
      finalEditSeconds: shot.sec,
    },
    requestedOutput: { duration, resolution, aspectRatio },
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
          ? "Upload this Primary Identity image to Vibes as the start/reference image."
          : "Keep this reference in the Film Studio manifest; Vibes manual handoff uses one primary image.",
    })),
    localReferences: localReferences.map((item) => ({
      key: item.key,
      label: item.label,
      instruction: "Upload this locally stored image to Vibes as the start/reference image.",
    })),
    prompt: buildVibesPrompt({
      project,
      scene,
      shot,
      plan,
      characters,
      duration,
      aspectRatio,
    }),
    returnStep:
      "Download the completed MP4 from Vibes, return to this Shot Editor, and use Upload completed take.",
  };
}

export function vibesHandoffFilename(projectId, shotId) {
  const safe = (value) =>
    String(value || "shot")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "shot";
  return `${safe(projectId)}-shot-${safe(shotId)}-vibes-handoff.json`;
}
