import { fail } from "./contract.js";

export const DRAW_THINGS_LOCAL_PROVIDER_ID = "draw-things-local";

const localOnly = () =>
  fail(
    "MANUAL_PROVIDER",
    "Draw Things runs locally on the filmmaker's Mac. Use the Film Studio handoff, then upload the completed still.",
    409,
  );

export function createDrawThingsLocalProvider() {
  return {
    capabilities: {
      id: DRAW_THINGS_LOCAL_PROVIDER_ID,
      label: "Draw Things · Local still · $0",
      paid: false,
      manual: true,
      local: true,
      outputType: "image",
      uiHint:
        "Film Studio packages the shot prompt and selected Character Bible references. Generation stays on this Mac with Cloud Compute off, so Film Studio charges $0.",
      ledgerRoutes: { "1024x576": DRAW_THINGS_LOCAL_PROVIDER_ID },
      model: "realistic-vision-v5.1-8bit",
      durations: [1],
      resolutions: ["1024x576", "768x432"],
      aspectRatios: ["16:9", "4:5", "1:1", "9:16"],
      maxReferences: 3,
      cancelRunning: false,
    },
    estimate: () => ({
      estimatedCost: 0,
      currency: "USD",
      priceBasis: "local-device-generation-not-billed",
    }),
    start: localOnly,
    status: localOnly,
    cancel: localOnly,
    asset: localOnly,
  };
}
