import {
  normalizeLedgerEntry,
  GENERATION_TYPES,
  PROJECT_ID,
} from "./domain.js";
import { createSalvageRecord, parseUsableRangeText } from "./economy.js";

export function approveTakeState(current, shotId, takeId, plan) {
  const targetShot = current.shots.find((shot) => shot.id === shotId);
  if (!targetShot) return current;
  const selected = targetShot.takes.find((take) => take.id === takeId);
  if (!selected) return current;
  const sourceDuration = Number(
    selected.generatedSeconds || plan.requestSeconds || targetShot.sec || 0,
  );
  const parsedRanges = selected.usableRanges?.length
    ? selected.usableRanges
    : parseUsableRangeText(selected.usableRangeText || "", sourceDuration);
  const salvage = createSalvageRecord({
    takeId,
    ranges: parsedRanges,
    sourceDuration,
    usableSeconds: Number(selected.usableSeconds || 0),
    uses: [`scene:${targetShot.scene}/shot:${targetShot.id}`],
    notes: selected.notes || "",
  });
  const reviewedUsableSeconds = salvage.usableSeconds;
  const reusableAssetId = `take:${targetShot.id}:${takeId}`;
  const takes = targetShot.takes.map((take) => ({
    ...take,
    status:
      take.id === takeId
        ? "Approved"
        : take.status === "Approved"
          ? "Rejected"
          : take.status,
  }));

  const foundIndex = current.ledger.findIndex(
    (entry) => entry.generationId === takeId,
  );
  const pendingIndex = foundIndex < 0 ? undefined : foundIndex;
  const ledger = [...current.ledger];
  const completed = normalizeLedgerEntry({
    ...(pendingIndex !== undefined ? ledger[pendingIndex] : {}),
    id:
      pendingIndex !== undefined
        ? ledger[pendingIndex].id
        : `ledger:${targetShot.id}:${takeId}:${Date.now()}`,
    projectId: current.project.id || PROJECT_ID,
    sceneId: targetShot.scene,
    shotId: targetShot.id,
    generationId: takeId,
    provider: selected.provider || plan.route.provider,
    model: selected.model || plan.route.model,
    routeId:
      pendingIndex !== undefined ? ledger[pendingIndex].routeId : plan.route.id,
    shotClass: plan.shotClass,
    generationType: GENERATION_TYPES.VIDEO,
    estimatedCost:
      pendingIndex !== undefined
        ? ledger[pendingIndex].estimatedCost
        : plan.oneAttemptCost,
    actualCost:
      selected.renderId && pendingIndex !== undefined
        ? ledger[pendingIndex].actualCost
        : Number(selected.cost || 0),
    generationStatus: "completed",
    approvalStatus: "approved",
    timestamp: new Date().toISOString(),
    requestHash:
      pendingIndex !== undefined
        ? ledger[pendingIndex].requestHash || null
        : plan.requestHash,
    requestSeconds:
      pendingIndex !== undefined
        ? ledger[pendingIndex].requestSeconds
        : plan.requestSeconds,
    generatedSeconds: sourceDuration,
    usableSeconds: reviewedUsableSeconds,
    salvageStatus: reviewedUsableSeconds > 0 ? "salvaged" : "unreviewed",
    reusableAssetId,
    metadata: {
      ...(pendingIndex !== undefined ? ledger[pendingIndex].metadata : {}),
      salvage,
    },
    label: `Shot ${targetShot.id} approved take`,
  });
  for (let i = 0; i < ledger.length; i++)
    if (
      ledger[i].shotId === targetShot.id &&
      ledger[i].generationId !== takeId &&
      ledger[i].approvalStatus === "approved"
    )
      ledger[i] = { ...ledger[i], approvalStatus: "rejected" };
  if (pendingIndex !== undefined) ledger[pendingIndex] = completed;
  else if (completed.actualCost > 0) ledger.push(completed);

  return {
    ...current,
    shots: current.shots.map((item) =>
      item.id === targetShot.id
        ? { ...item, takes, approved: true, cost: Number(selected.cost || 0) }
        : item,
    ),
    ledger,
  };
}

export function updateTakeState(current, shotId, takeId, patch) {
  const selected = current.shots
    .find((s) => s.id === shotId)
    ?.takes.find((t) => t.id === takeId);
  if (!selected) return current;
  const safe = { ...patch };
  if (selected.renderId) {
    delete safe.cost;
    delete safe.generatedSeconds;
  } else if ("cost" in safe)
    safe.cost = Number.isFinite(Number(safe.cost))
      ? Math.max(0, Number(safe.cost))
      : 0;
  return {
    ...current,
    shots: current.shots.map((item) => {
      if (item.id !== shotId) return item;
      const takes = item.takes.map((t) =>
        t.id === takeId ? { ...t, ...safe } : t,
      );
      return {
        ...item,
        takes,
        approved: takes.some((t) => t.status === "Approved"),
      };
    }),
    ledger: current.ledger.map((entry) =>
      entry.generationId === takeId && safe.status
        ? {
            ...entry,
            approvalStatus: safe.status === "Rejected" ? "rejected" : "pending",
          }
        : entry,
    ),
  };
}
