import React, { useEffect, useRef, useState } from "react";
import { renderIdentity, renderRequestKey, renderRequest } from "./renderClient.js";

async function encodeImage(file) {
  if (
    !file ||
    !["image/png", "image/jpeg"].includes(file.type) ||
    file.size > 2 * 1024 * 1024
  )
    throw new Error(
      "Selected references must be stored PNG/JPEG images no larger than 2 MB.",
    );
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return { mimeType: file.type, data };
}
export default function RenderPanel({
  shot,
  project,
  characters,
  scene,
  plan,
  continuity,
  getMedia,
  onRender,
  renders,
}) {
  const [catalog, setCatalog] = useState(null),
    [provider, setProvider] = useState("mock");
  const [duration, setDuration] = useState(8),
    [resolution, setResolution] = useState("720p"),
    [aspectRatio, setAspect] = useState("16:9");
  const [selected, setSelected] = useState([]),
    [quote, setQuote] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef(null),
    submitting = useRef(false);
  const refs = characters.flatMap((c) =>
    Object.entries(c.refs || {}).map(([slot, ref]) => ({
      key: ref.key,
      label: `${c.name} · ${slot}`,
    })),
  );
  const capabilities = catalog?.providers.find((p) => p.id === provider);
  const active = renders.filter(
    (r) => r.shotId === shot.id && r.sceneId === shot.scene,
  );
  useEffect(() => {
    renderRequest("/api/renderers")
      .then(setCatalog)
      .catch((e) => setError(e.message));
  }, []);
  async function input() {
    // Fail closed when local metadata points to missing blobs before any paid submission.
    if (capabilities?.paid) {
      for (const c of characters)
        for (const r of Object.values(c.refs || {}))
          if (!(await getMedia(r.key)))
            throw new Error(
              `${c.name}: a Character Bible image is missing from browser storage.`,
            );
    }
    return {
      projectId: project.id,
      sceneId: shot.scene,
      shotId: shot.id,
      provider,
      prompt: plan.prompt,
      duration,
      resolution,
      aspectRatio,
      referenceImages: await Promise.all(
        selected.map(async (key) => encodeImage(await getMedia(key))),
      ),
      continuity: {
        ready: continuity.ready,
        animaticLocked: Boolean(scene?.animaticLocked),
        timingApproved: Boolean(shot.economy?.animaticApproved),
        hasCharacters: characters.length > 0,
      },
    };
  }
  useEffect(() => {
    let canceled = false;
    setQuote(null);
    setError("");
    input()
      .then((body) =>
        renderRequest("/api/renders", { ...body, estimateOnly: true }),
      )
      .then((q) => {
        if (!canceled) setQuote(q);
      })
      .catch((e) => {
        if (!canceled) setError(e.message);
      });
    return () => {
      canceled = true;
    };
  }, [
    provider,
    duration,
    resolution,
    aspectRatio,
    selected,
    plan.prompt,
    characters.map((c) => JSON.stringify(c.refs)).join("|"),
    continuity.ready,
    scene?.animaticLocked,
    shot.economy?.animaticApproved,
  ]);
  const paidAttempts = active.filter(
    (r) => r.provider !== "mock" && r.status !== "canceled",
  ).length;
  const shotSpend = active
    .filter((r) => r.provider !== "mock")
    .reduce((s, r) => s + (r.actualCost || 0) + (r.reservedCost || 0), 0);
  const liveBlock = !capabilities?.paid
    ? ""
    : !catalog?.policy.liveEnabled
      ? "Live rendering is disabled on the server."
      : !continuity.ready
        ? "Complete and lock the Character Bible first."
        : !scene?.animaticLocked || !shot.economy?.animaticApproved
          ? "Approve shot timing and lock the scene animatic first."
          : characters.length && !selected.length
            ? "Select character reference images."
            : paidAttempts >= (shot.economy?.maxAttempts || 2)
              ? "Shot attempt limit reached."
              : shotSpend + (quote?.estimatedCost || 0) >
                  (shot.economy?.shotCap ?? 0)
                ? "Shot cost ceiling would be exceeded."
                : "";
  async function generate() {
    if (submitting.current || liveBlock || !quote) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const storageKey = `fpai-pending-render:${project.id}:${shot.scene}:${shot.id}`;
    try {
      const body = await input();
      const identity = await renderIdentity(body);
      if (!pending.current) {
        try {
          pending.current = JSON.parse(localStorage.getItem(storageKey));
        } catch {}
      }
      if (pending.current && pending.current.identity !== identity)
        throw new Error(
          "An earlier submission is unresolved. Restore its inputs or check render status before creating a new request.",
        );
      pending.current ||= { identity, key: renderRequestKey() };
      localStorage.setItem(storageKey, JSON.stringify(pending.current));
      const { render } = await renderRequest("/api/renders", {
        ...body,
        requestKey: pending.current.key,
        acceptedCost: quote.estimatedCost,
      });
      onRender(render);
      pending.current = null;
      localStorage.removeItem(storageKey);
    } catch (e) {
      if ([400, 401, 403, 409, 413, 415].includes(e.status)) {
        pending.current = null;
        localStorage.removeItem(storageKey);
      }
      setError(e.message);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  async function cancel(render) {
    try {
      const result = await renderRequest(
        `/api/renders/${render.id}/cancel`,
        {},
      );
      onRender(result.render);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section className="renderPanel">
      <h3>Generate Take</h3>
      <div className="formGrid two">
        <label>
          Renderer
          <select
            aria-label="Renderer"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setDuration(8);
              setResolution("720p");
              setAspect("16:9");
            }}
          >
            {(catalog?.providers || [{ id: "mock", label: "Mock · $0" }]).map(
              (p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Source duration
          <select
            aria-label="Source duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {(capabilities?.durations || [8]).map((v) => (
              <option key={v} value={v}>
                {v} seconds
              </option>
            ))}
          </select>
        </label>
        <label>
          Resolution
          <select
            aria-label="Resolution"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            {(capabilities?.resolutions || ["720p"]).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Aspect ratio
          <select
            aria-label="Aspect ratio"
            value={aspectRatio}
            onChange={(e) => setAspect(e.target.value)}
          >
            {(capabilities?.aspectRatios || ["16:9"]).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <p>
        Final edit: {shot.sec}s. Source clip: {duration}s. Select up to three
        references for rendering; all Bible references remain saved.
      </p>
      {refs.map((ref) => (
        <label key={ref.key} className="checkLabel">
          <input
            type="checkbox"
            checked={selected.includes(ref.key)}
            disabled={!selected.includes(ref.key) && selected.length >= 3}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? [...selected, ref.key]
                  : selected.filter((k) => k !== ref.key),
              )
            }
          />
          <span>{ref.label}</span>
        </label>
      ))}
      {capabilities?.previewOnly && (
        <p>
          Mock produces a playable test slate. It does not simulate Marcus or
          change character locks.
        </p>
      )}
      <p aria-live="polite">
        Estimated render cost:{" "}
        <b>{quote ? `$${quote.estimatedCost.toFixed(2)}` : "Checking…"}</b>
        {quote &&
          ` · Session ceiling $${quote.policy.sessionCeiling.toFixed(2)} · Project ceiling $${quote.policy.projectCeiling.toFixed(2)}`}
      </p>
      {liveBlock && <div className="validation">{liveBlock}</div>}
      {error && (
        <div role="alert" className="validation">
          {error}
        </div>
      )}
      <button
        className="primary full"
        disabled={busy || !quote || Boolean(liveBlock)}
        onClick={generate}
      >
        {busy
          ? "Submitting…"
          : `Generate Take${quote ? ` · $${quote.estimatedCost.toFixed(2)}` : ""}`}
      </button>
      <div aria-live="polite">
        {active.map((r) => (
          <div className="renderStatus" key={r.id}>
            <b>
              {r.provider} · {r.status}
            </b>
            <small>
              {r.id} · Cost{" "}
              {r.actualCost === null
                ? "pending"
                : `$${r.actualCost.toFixed(2)}`}
            </small>
            {r.error && <p>{r.error.message}</p>}
            {["queued", "running"].includes(r.status) && (
              <button className="ghost" onClick={() => cancel(r)}>
                Cancel render
              </button>
            )}
            {r.status === "uncertain" && (
              <p>
                Submission outcome needs reconciliation. Reservation retained.
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
