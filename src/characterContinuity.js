import continuity from "./characterContinuity.json" with { type: "json" };
import { withTarmacCharacterLocks } from "./tarmacContinuity.js";

export { continuity as CHARACTER_CONTINUITY };

export function withCharacterContinuity(prompt, { projectId, sceneId, shotId, characters = [] } = {}) {
  const source = String(prompt || "").trim();
  if (projectId !== continuity.projectId || !characters.length) return source;
  const cast = characters.filter((character) => continuity.characters[character.id]);
  if (!cast.length) return source;

  const identity = cast.map((character) => {
    const rule = continuity.characters[character.id];
    const selectedWardrobe = String(character.wardrobe || "").trim();
    return `${character.name || character.id}: ${rule.identity} ${rule.wardrobe} ${selectedWardrobe ? `SELECTED LOOK: ${selectedWardrobe}.` : ""} ${rule.avoid} ${shotId === "012" && character.id === "turner" ? rule.woundedShot : ""}`.trim();
  });
  const scenePrompt = withTarmacCharacterLocks(source, {
    sceneId,
    characterIds: cast.map((character) => character.id),
  });
  const shotRule = continuity.shotRules[String(shotId).padStart(3, "0")];
  return [
    `CHARACTER CONTINUITY: ${continuity.referencePolicy}`,
    ...identity,
    `SKIN AND LIGHT: ${continuity.skinPolicy}`,
    `MOTION: ${continuity.motionPolicy}`,
    shotRule ? `SHOT ${String(shotId).padStart(3, "0")}: ${shotRule}` : "",
    scenePrompt.includes("SHOT PROMPT:") ? scenePrompt : `SHOT PROMPT: ${scenePrompt}`,
  ].filter(Boolean).join(" ");
}
