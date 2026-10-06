export const GROOVES_PROJECT_ID = "grooves-pv-talking-2026-10-05";
export const GROOVES_SESSION_ID = "grooves-pv-one-take-2026-10-05";
export const GROOVES_CAP_USD = 1.30;
export const GROOVES_PROVIDER = "higgsfield-kling-3-standard";
export const groovesProduction = {
  project: { id: GROOVES_PROJECT_ID, title: "GROOVES PV", subtitle: "Approved cast · one talking clip", runtime: 10, budget: GROOVES_CAP_USD, openingBudget: GROOVES_CAP_USD, drift: "STRICT", ownerId: "owner", productionBudget: {original: GROOVES_CAP_USD, current: GROOVES_CAP_USD, locked: true, history: []} },
  characters: [], scenes: [], assets: [], providers: [], shots: [], ledger: [],
};

// Separate authorization; Standard's consumed project/session remains unchanged.
export const GROOVES_PRO_PROJECT_ID = "grooves-pv-pro-2026-10-06";
export const GROOVES_PRO_SESSION_ID = "grooves-pv-pro-one-take-2026-10-06";
export const GROOVES_PRO_CAP_USD = 1.68;
export const GROOVES_COMBINED_CAP_USD = 2.94;
export const GROOVES_PRO_PROVIDER = "higgsfield-kling-3-pro";
export function groovesPlanFor(projectId) {
  if (projectId === GROOVES_PROJECT_ID) return { provider: GROOVES_PROVIDER, resolution: "720p", cap: GROOVES_CAP_USD, sessionId: GROOVES_SESSION_ID };
  if (projectId === GROOVES_PRO_PROJECT_ID) return { provider: GROOVES_PRO_PROVIDER, resolution: "1080p", cap: GROOVES_PRO_CAP_USD, sessionId: GROOVES_PRO_SESSION_ID };
  return null;
}
export const groovesProProduction = {
  ...groovesProduction,
  project: { ...groovesProduction.project, id: GROOVES_PRO_PROJECT_ID, title: "GROOVES PV PRO", subtitle: "Approved cast · restrained hands · one Pro clip", budget: GROOVES_PRO_CAP_USD, openingBudget: GROOVES_PRO_CAP_USD,
    productionBudget: { original: GROOVES_PRO_CAP_USD, current: GROOVES_PRO_CAP_USD, locked: true, history: [] } },
};
