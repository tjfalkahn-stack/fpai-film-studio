import { fail } from "./contract.js";

export const VIBES_MANUAL_PROVIDER_ID = "vibes-manual";

const manualOnly = () =>
  fail(
    "MANUAL_PROVIDER",
    "Vibes uses a manual browser handoff. Open Vibes from Film Studio, then upload the completed take for review.",
    409,
  );

export function createVibesManualProvider() {
  return {
    capabilities: {
      id: VIBES_MANUAL_PROVIDER_ID,
      label: "Vibes · Manual free handoff",
      paid: false,
      manual: true,
      externalUrl: "https://vibes.ai/",
      uiHint:
        "Film Studio prepares the prompt and continuity handoff. Vibes runs in its own browser tab; return here and upload the downloaded MP4 as a completed take.",
      ledgerRoutes: { "720p": VIBES_MANUAL_PROVIDER_ID },
      model: "vibes-ai-web",
      durations: [4, 6, 8],
      resolutions: ["720p"],
      aspectRatios: ["16:9", "9:16", "1:1"],
      maxReferences: 1,
      cancelRunning: false,
    },
    estimate: () => ({
      estimatedCost: 0,
      currency: "USD",
      priceBasis: "external-manual-service-not-billed-by-fpai",
    }),
    start: manualOnly,
    status: manualOnly,
    cancel: manualOnly,
    asset: manualOnly,
  };
}
