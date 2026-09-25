export const YARD_PROJECT_ID = "the-yard-homecoming";

const shots = [
  ["PV", "Prairie View flagpoles", "Friends walk toward the Prairie View A&M entrance flagpoles. A gentle forward camera move and breeze animate flags and clothing. Keep the brick sign and pole placement stable, faces consistent, and purple and gold accents visible. No added words or logos."],
  ["TSU", "Texas Southern entrance", "Three friends walk beneath the Texas Southern University arch. Gentle tracking motion; preserve the lettering, brick pillars, faces, maroon and gray clothing. No new text or logos."],
  ["LAMAR", "Lamar sign", "Friends greet beside the Lamar University sign with a natural shoulder tap. Subtle rightward tracking; preserve the sign, faces, and red and white accents. No invented insignia."],
  ["SOUTHERN", "Southern campus band", "Friends react to the band. Small natural gestures and coordinated musician movement in blue and gold. Keep the landscaped SOUTHERN letters readable and instruments consistent."],
  ["DRONE", "Southern drone band", "High overhead drone view rises slowly and drifts back as the Southern band marches in coherent formation. Keep yard lines straight, spacing plausible, and blue and gold uniforms consistent."],
  ["ALCORN", "Alcorn reunion", "Friends complete a natural reunion hug, camera arcs gently. Preserve the ALCORN STATE UNIVERSITY sign, faces and purple and gold clothes. Avoid invented building geometry."],
  ["SPK", "PV spokesperson face test", "One spokesperson faces the camera in a purple and gold rugby top. A subtle blink, natural breathing, and a small smile. Keep her facial features, hair, hands, clothing, and background consistent. No head turn, speech, new text, or extra people."],
];

export const yardProduction = {
  project: {
    id: YARD_PROJECT_ID,
    title: "THE YARD IS HOME",
    subtitle: "Friends of the Program · five-school homecoming spot",
    runtime: 30,
    budget: 20,
    productionBudget: { original: 20, current: 20, locked: false, lockedAt: null, history: [] },
    openingBudget: 20,
    drift: "STRICT",
    ownerId: "owner",
  },
  characters: [],
  scenes: [{ id: "YARD", title: "Five campuses / homecoming", purpose: "Friends reunite across PV, TSU, Lamar, Southern and Alcorn.", location: "Five campuses", weather: "Warm afternoon", status: "POC", animaticLocked: false, animaticLockedAt: null }],
  assets: [],
  providers: [],
  shots: shots.map(([id, subject, prompt], index) => ({
    id, scene: "YARD", sec: id === "SPK" ? 6 : 3, mode: "CONTROL", subject,
    move: index === 4 ? "Overhead drone rise" : "Subtle tracking",
    characters: [], assets: [], status: "Planned", prompt,
    provider: "auto", cost: 0, approved: false, takes: [], drift: "STRICT",
    economy: { motionNeed: "generative", shotCap: 2, maxAttempts: 1, manualRouteId: "auto", animaticApproved: false },
  })),
  ledger: [],
};
