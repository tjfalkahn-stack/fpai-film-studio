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
