import { MOCK_VIDEO_BASE64 } from "./mock-video.js";

export function createMockProvider() {
  return {
    capabilities: {
      id: "mock",
      label: "Mock · $0",
      paid: false,
      previewOnly: true,
      ledgerRoutes: { "720p": "mock" },
      model: "fpai-test-slate-v1",
      durations: [8],
      resolutions: ["720p"],
      aspectRatios: ["16:9"],
      maxReferences: 6,
      cancelRunning: true,
    },
    estimate: () => ({
      estimatedCost: 0,
      currency: "USD",
      priceBasis: "mock-no-charge",
    }),
    start: async (input) => ({
      operationId: `mock/${crypto.randomUUID()}`,
      debug: {
        characterReferenceSelection: input.characterReferenceSelection || null,
        transmittedAssetIds: (input.characterReferenceSelection?.transmitted || []).map(
          (item) => item.assetId,
        ),
        referenceImagesTransmitted: (input.referenceImages || []).length,
      },
    }),
    status: async (job) =>
      Date.now() - Date.parse(job.created_at) < 4000
        ? { status: "running" }
        : {
            status: "completed",
            actualCost: 0,
            costBasis: "mock-no-charge",
            asset: { mock: true },
          },
    cancel: async () => ({ status: "canceled" }),
    asset: async () =>
      new Response(
        Uint8Array.from(atob(MOCK_VIDEO_BASE64), (c) => c.charCodeAt(0)),
        { headers: { "content-type": "video/mp4" } },
      ),
  };
}
