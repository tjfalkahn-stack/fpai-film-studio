import { stableHash } from "./economy.js";

export async function renderIdentity(input, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) {
    if (input.provider !== "mock")
      throw new Error("Open Film Studio over HTTPS before submitting a paid render.");
    // HTTP previews lack SubtleCrypto. This is only a local retry hint for $0
    // mocks; the Worker always verifies the full payload with SHA-256.
    // Do not copy potentially large reference-image bytes into localStorage.
    return `mock-preview:${stableHash(input)}`;
  }
  const digest = await cryptoApi.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(input)),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export function renderRequestKey(cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.getRandomValues)
    throw new Error("This browser cannot create a secure render request ID.");
  // getRandomValues works in HTTP previews too; randomUUID requires HTTPS.
  return Array.from(cryptoApi.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function renderRequest(path, body) {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      result.error?.message ||
        result.error ||
        `Render service HTTP ${response.status}`,
    );
    error.status = response.status;
    throw error;
  }
  return result;
}

export function mergeRender(current, render) {
  if (render.projectId !== current.project.id) return current;
  const generationStatus = ["starting", "uncertain"].includes(render.status)
    ? "running"
    : render.status;
  const id = `render:${render.id}`;
  const previous = current.ledger.find((entry) => entry.id === id);
  const entry = {
    ...previous,
    id,
    projectId: render.projectId,
    sceneId: render.sceneId,
    shotId: render.shotId,
    generationId: render.id,
    provider: render.provider,
    model: render.model,
    routeId: render.routeId || render.provider,
    generationType: "video generation",
    estimatedCost: render.estimatedCost,
    actualCost: render.actualCost ?? 0,
    generationStatus,
    approvalStatus: previous?.approvalStatus || "pending",
    requestSeconds: render.duration,
    generatedSeconds: render.status === "completed" ? render.duration : 0,
    usableSeconds: previous?.usableSeconds || 0,
    timestamp: render.createdAt,
    currency: "USD",
    metadata: {
      ...previous?.metadata,
      renderId: render.id,
      status: render.status,
      costBasis: render.costBasis,
      billingPending: render.actualCost === null,
      error: render.error,
    },
    label: `Shot ${render.shotId} · ${render.providerLabel || render.provider} render`,
  };
  const ledger = previous
    ? current.ledger.map((e) => (e.id === id ? entry : e))
    : [...current.ledger, entry];
  const shots = current.shots.map((shot) => {
    if (
      shot.id !== render.shotId ||
      shot.scene !== render.sceneId ||
      !render.outputAsset
    )
      return shot;
    if (shot.takes.some((t) => t.renderId === render.id)) return shot;
    return {
      ...shot,
      takes: [
        ...shot.takes,
        {
          id: render.id,
          renderId: render.id,
          key: null,
          url: render.outputAsset.url,
          name: `${render.provider}-shot-${render.shotId}.mp4`,
          status: "Review",
          cost: render.actualCost ?? 0,
          provider: render.provider,
          model: render.model,
          generatedSeconds: render.duration,
          continuity: 0,
          usableSeconds: 0,
          usableRanges: [],
          usableRangeText: "",
          notes: "",
        },
      ],
    };
  });
  return { ...current, ledger, shots };
}
