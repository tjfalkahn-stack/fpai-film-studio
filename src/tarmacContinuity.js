export const TARMAC_REFERENCE_NAME = "Mother and Son in Urban Shadows(1).png";

export const TARMAC_CHARACTER_LOCKS = Object.freeze({
  jasmine: Object.freeze({
    wardrobe:
      "Scene 001 Tarmac: matte-black zip-front bomber jacket with ribbed cuffs, fitted black scoop-neck tank top, high-waisted black cargo pants with large flap thigh pockets, thin large gold hoop earrings, black shoulder bag strap over her left shoulder",
    appearanceLock:
      "Adult light-complexioned, fair-skinned Black woman, lean athletic build, long oval face, high cheekbones, defined jawline, dark-brown almond-shaped eyes, sharply defined arched brows, straight narrow nose, full lips, and very long dense black wavy-curly hair worn loose with a deep side part and laid edges, falling below her waist",
    continuityNote:
      "Match Jasmine's exact facial identity, hairline, hair length, skin tone, build, and proportions to the approved airport reference. Do not substitute a similar-looking woman.",
  }),
  mikey: Object.freeze({
    wardrobe:
      "Scene 001 Tarmac: black Nike pullover hoodie with a small white Nike wordmark and Swoosh on the left chest, matching black Nike jogger pants with a small white Nike wordmark and Swoosh on the upper left thigh, black backpack with a subtle checkerboard weave and two padded shoulder straps",
    appearanceLock:
      "Exactly six-year-old light-complexioned, fair-skinned Black boy with small slim child proportions, softly rounded oval face, smooth rounded cheeks, dark-brown almond-shaped eyes, softly curved brows, small rounded nose, full childlike lips, and short dense black corkscrew curls with neatly tapered sides",
    continuityNote:
      "Match Mikey's exact facial identity, curl pattern, hair silhouette, skin tone, age, and child proportions to the approved airport reference. He must remain exactly six years old and must not look like a toddler, teenager, or small adult.",
    voice: "Natural six-year-old",
  }),
});

export function applyTarmacCharacterLocks(characters = []) {
  return characters.map((character) => {
    const lock = TARMAC_CHARACTER_LOCKS[character.id];
    return lock ? { ...character, ...lock } : character;
  });
}

export function withTarmacCharacterLocks(prompt, { sceneId, characterIds = [] } = {}) {
  if (String(sceneId) !== "001") return String(prompt || "").trim();
  const locks = characterIds
    .map((id) => {
      const lock = TARMAC_CHARACTER_LOCKS[id];
      if (!lock) return "";
      return `${String(id).toUpperCase()} EXACT LIKENESS LOCK: ${lock.appearanceLock}. EXACT AIRPORT WARDROBE: ${lock.wardrobe}. ${lock.continuityNote}`;
    })
    .filter(Boolean);
  if (!locks.length) return String(prompt || "").trim();
  return `${locks.join(" ")} SHOT PROMPT: ${String(prompt || "").trim()}`.trim();
}
