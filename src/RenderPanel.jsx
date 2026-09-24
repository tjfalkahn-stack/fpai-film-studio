import React, { useEffect, useRef, useState } from "react";
import { renderIdentity, renderRequestKey, renderRequest } from "./renderClient.js";
import { isSeedanceProvider } from "./seedanceRequest.js";
import {
  buildVibesHandoff,
  VIBES_MANUAL_PROVIDER_ID,
  VIBES_URL,
  vibesHandoffFilename,
} from "./vibesWorkflow.js";
import {
  buildDrawThingsHandoff,
  DRAW_THINGS_LOCAL_PROVIDER_ID,
  drawThingsHandoffFilename,
} from "./drawThingsWorkflow.js";
import { withTarmacCharacterLocks } from "./tarmacContinuity.js";
import { YARD_PROJECT_ID } from "./yardProduction.js";
import {
  START_FRAME_PROVIDER_LIMIT,
  isLtxProviderId,
  renderReferenceKeys,
} from "./shotStartFrame.js";

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  if (file.size <= START_FRAME_PROVIDER_LIMIT) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / bitmap.width, 1080 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.92, 0.86, 0.8, 0.72]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= START_FRAME_PROVIDER_LIMIT) return blob;
  }
  throw new Error("Shot Start Frame could not be prepared under the provider's 2 MB limit.");
}

async function encodeImage(file) {
  if (!file || !["image/png", "image/jpeg"].includes(file.type))
    throw new Error(
      "Selected references must be stored PNG/JPEG images.",
    );
  const prepared = await compressImage(file);
  return { mimeType: prepared.type, data: await fileToBase64(prepared) };
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
    [provider, setProvider] = useState(project.id === YARD_PROJECT_ID ? "ltx-2.5-fast" : "mock");
  const [duration, setDuration] = useState(project.id === YARD_PROJECT_ID ? 6 : 8),
    [resolution, setResolution] = useState("720p"),
    [aspectRatio, setAspect] = useState(project.id === YARD_PROJECT_ID ? "9:16" : "16:9");
  const [selected, setSelected] = useState([]),
    [quote, setQuote] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [manualNotice, setManualNotice] = useState("");
  const pending = useRef(null),
    submitting = useRef(false);
  const characterRefs = characters.flatMap((c) =>
    Object.entries(c.refs || {}).map(([slot, ref]) => ({
      key: ref.key,
      assetId: ref.assetId,
      assetUrl: ref.assetUrl,
      label: `${c.name} · ${slot}`,
    })),
  );
  const refs = shot.startFrame?.key
    ? [
        {
          key: shot.startFrame.key,
          label: `Shot ${shot.id} · Start Frame`,
          startFrame: true,
        },
        ...characterRefs,
      ]
    : characterRefs;
  const capabilities = catalog?.providers.find((p) => p.id === provider);
  const generationPrompt = withTarmacCharacterLocks(plan.prompt, {
    sceneId: shot.scene,
    characterIds: characters.map((character) => character.id),
  });
  const isVibesManual = provider === VIBES_MANUAL_PROVIDER_ID;
  const isDrawThingsLocal = provider === DRAW_THINGS_LOCAL_PROVIDER_ID;
  const isLtx = isLtxProviderId(provider);
  const isManualProvider = Boolean(capabilities?.manual);
  const active = renders.filter(
    (r) => r.shotId === shot.id && r.sceneId === shot.scene,
  );
  useEffect(() => {
    renderRequest("/api/renderers")
      .then(setCatalog)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (isLtx && shot.startFrame?.key) setSelected([shot.startFrame.key]);
  }, [isLtx, shot.startFrame?.key]);
  async function input() {
    // Fail closed when local metadata points to missing blobs before any paid submission.
    if (capabilities?.paid) {
      for (const c of characters)
        for (const r of Object.values(c.refs || {})) {
          if (r.assetUrl || String(r.key || "").startsWith("library:")) continue;
          if (!(await getMedia(r.key)))
            throw new Error(
              `${c.name}: a Character Bible image is missing from browser storage.`,
            );
        }
    }
    const inline = [];
    if (!isManualProvider) {
      const referenceKeys = renderReferenceKeys({
        provider,
        startFrameKey: shot.startFrame?.key,
        selected,
      });
      for (const key of referenceKeys) {
        const file = await getMedia(key);
        if (file) inline.push(await encodeImage(file));
      }
    }
    return {
      projectId: project.id,
      sceneId: shot.scene,
      shotId: shot.id,
      provider,
      prompt: generationPrompt,
      duration,
      resolution,
      aspectRatio,
      referenceImages: inline,
      generateAudio: String(provider).startsWith("seedance-") ? true : undefined,
      characterIds: characters.map((c) => c.id),
      characters: characters.map((c) => ({
        id: c.id,
        name: c.name,
        wardrobe: c.wardrobe,
      })),
      shotSubject: shot.subject,
      shotMove: shot.move,
      startFrame: shot.startFrame
        ? {
            name: shot.startFrame.name,
            key: shot.startFrame.key,
            role: "opening-frame",
          }
        : null,
      shotContext: {
        subject: shot.subject,
        move: shot.move,
        prompt: generationPrompt,
      },
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
    generationPrompt,
    characters.map((c) => JSON.stringify(c.refs)).join("|"),
    continuity.ready,
    scene?.animaticLocked,
    shot.economy?.animaticApproved,
    shot.subject,
    shot.move,
    characters.map((c) => c.id).join("|"),
  ]);
  const paidAttempts = active.filter(
    (r) => r.provider !== "mock" && r.status !== "canceled",
  ).length;
  const shotSpend = active
    .filter((r) => r.provider !== "mock")
    .reduce((s, r) => s + (r.actualCost || 0) + (r.reservedCost || 0), 0);
  const providerLiveReady = isSeedanceProvider(provider)
    ? Boolean(catalog?.policy?.seedanceLiveEnabled)
    : String(provider).startsWith("ltx-2.5-")
      ? Boolean(catalog?.policy?.ltxLiveEnabled)
    : Boolean(catalog?.policy?.liveEnabled);
  const liveBlock = !capabilities?.paid
    ? ""
    : project.id === YARD_PROJECT_ID && (shot.id !== "PV" || provider !== "ltx-2.5-fast")
      ? "Only one PV LTX 2.5 Fast trial is enabled. Other Yard shots remain gated."
    : !providerLiveReady
      ? isSeedanceProvider(provider)
        ? "Seedance live rendering is disabled on the server."
        : String(provider).startsWith("ltx-2.5-")
          ? "LTX live rendering is disabled on the server."
        : "Live rendering is disabled on the server."
      : !continuity.ready
        ? "Complete and lock the Character Bible first."
        : !scene?.animaticLocked || !shot.economy?.animaticApproved
          ? "Approve shot timing and lock the scene animatic first."
          : isLtx && !shot.startFrame?.key
            ? "Upload a composed Shot Start Frame before submitting LTX image-to-video."
          : characters.length &&
              !selected.length &&
              !quote?.debug?.selectedAssetIds?.length
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
  function vibesHandoff() {
    return buildVibesHandoff({
      project,
      scene,
      shot,
      plan: { ...plan, prompt: generationPrompt },
      characters,
      duration,
      resolution,
      aspectRatio,
      referenceSelection: quote?.debug?.characterReferenceSelection,
      localReferences: refs.filter((ref) => selected.includes(ref.key)),
    });
  }
  function drawThingsHandoff() {
    return buildDrawThingsHandoff({
      project,
      scene,
      shot,
      plan: { ...plan, prompt: generationPrompt },
      characters,
      resolution,
      aspectRatio,
      referenceSelection: quote?.debug?.characterReferenceSelection,
      localReferences: refs.filter((ref) => selected.includes(ref.key)),
    });
  }
  async function copyVibesPrompt() {
    try {
      await navigator.clipboard.writeText(vibesHandoff().prompt);
      setManualNotice("Vibes prompt copied. Paste it into the Vibes prompt box.");
      setError("");
    } catch {
      setError("The prompt could not be copied. Download the handoff file instead.");
    }
  }
  function openVibes() {
    window.open(capabilities?.externalUrl || VIBES_URL, "_blank", "noopener,noreferrer");
    copyVibesPrompt();
  }
  function vibesReference() {
    const explicit = refs.find((ref) => selected.includes(ref.key));
    if (explicit) return explicit;
    const selectedAssetId = quote?.debug?.selectedAssetIds?.[0];
    return refs.find((ref) => ref.assetId === selectedAssetId) || null;
  }
  function drawThingsReferences() {
    const explicit = refs.filter((ref) => selected.includes(ref.key));
    const chosen = quote?.debug?.selectedAssetIds || [];
    const automatic = chosen
      .map((assetId) => refs.find((ref) => ref.assetId === assetId))
      .filter(Boolean);
    return [...explicit, ...automatic].filter(
      (ref, index, all) => all.findIndex((item) => item.key === ref.key) === index,
    );
  }
  async function downloadReference(reference, suffix, notice) {
    if (!reference) {
      setError("The selected reference image is unavailable. Open the Character Bible and restore it first.");
      return;
    }
    let url = reference.assetUrl || "";
    let revoke = false;
    const file = reference.key ? await getMedia(reference.key).catch(() => null) : null;
    if (file) {
      url = URL.createObjectURL(file);
      revoke = true;
    }
    if (!url) {
      setError("The selected reference image is unavailable. Open the Character Bible and restore it first.");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.id}-shot-${shot.id}-${suffix}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (revoke) URL.revokeObjectURL(url);
    setManualNotice(notice);
    setError("");
  }
  async function downloadVibesReference() {
    const reference = vibesReference();
    if (!reference) {
      setError("No Primary Identity image is available for this shot.");
      return;
    }
    await downloadReference(
      reference,
      "vibes-reference",
      "Primary Identity reference downloaded. Upload it to Vibes before pasting the prompt.",
    );
  }
  function downloadVibesHandoff() {
    const blob = new Blob([JSON.stringify(vibesHandoff(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = vibesHandoffFilename(project.id, shot.id);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setManualNotice("Vibes handoff downloaded. It contains the shot prompt and selected reference manifest.");
  }
  async function copyDrawThingsText(field, label) {
    try {
      await navigator.clipboard.writeText(drawThingsHandoff()[field]);
      setManualNotice(`${label} copied. Paste it into Draw Things.`);
      setError("");
    } catch {
      setError("The text could not be copied. Download the handoff file instead.");
    }
  }
  function downloadDrawThingsHandoff() {
    const blob = new Blob([JSON.stringify(drawThingsHandoff(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = drawThingsHandoffFilename(project.id, shot.id);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setManualNotice("Draw Things handoff downloaded with prompt, negative prompt, settings, and reference manifest.");
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
              const next = catalog?.providers.find((item) => item.id === e.target.value);
              setProvider(e.target.value);
              setDuration(next?.durations?.[0] ?? 8);
              setResolution(next?.resolutions?.[0] ?? "720p");
              setAspect(next?.aspectRatios?.[0] ?? "16:9");
              setManualNotice("");
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
        {!isDrawThingsLocal && (
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
        )}
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
        Final edit: {shot.sec}s. {isDrawThingsLocal ? "Still-image source. " : `Source clip: ${duration}s. `}The worker selects
        the Primary Identity image plus up to five supporting library photos
        for this shot. Manual PNG/JPEG boxes remain for older Bible uploads.
        {isDrawThingsLocal
          ? " Draw Things can use up to three identity and wardrobe references. The files are downloaded to this Mac and never transmitted by the adapter."
          : isVibesManual
          ? " Vibes uses one primary reference image. Film Studio preserves the full Character Bible and prepares a manual handoff; no Vibes credentials or production secrets are stored."
          : provider === "veo-fast"
          ? " Veo Fast transmits at most 3 PNG/JPEG images; the full selected set is preserved in the render manifest and is not implied to have been sent."
          : isLtx
            ? " LTX uses the dedicated composed Shot Start Frame as frame one. Character Bible portraits remain continuity references and are not substituted for the opening frame."
          : provider?.startsWith("seedance-")
            ? " Seedance consumes the Character Bible selection automatically (Marcus, Jasmine, Turner, Mikey) plus optional scene references. Audio is available at the same quoted video rate. Up to 9 images."
            : " Mock records the full selected set in debug output. Live providers still honor their own reference limits."}
      </p>
      {refs.map((ref) => (
        <label key={ref.key} className="checkLabel">
          <input
            type="checkbox"
            checked={isLtx && ref.startFrame ? true : selected.includes(ref.key)}
            disabled={
              (isLtx && ref.startFrame) ||
              (!selected.includes(ref.key) &&
                selected.length >= (capabilities?.maxReferences || 3))
            }
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
      {isLtx && !shot.startFrame?.key && (
        <div className="validation">
          Upload a composed Shot Start Frame above. LTX will not use a Character Bible portrait as this shot's opening frame.
        </div>
      )}
      {quote?.debug?.characterReferenceSelection && (
        <div className="mockDebug">
          <b>Selected generation references</b>
          <small>
            Lock versions:{" "}
            {JSON.stringify(quote.debug.lockVersions || {})}
            {quote.debug.fallbackApplied ? " · provider fallback applied" : ""}
          </small>
          <ol>
            {(quote.debug.characterReferenceSelection.selected || []).map((item) => (
              <li key={`${item.characterId}:${item.assetId}`}>
                {item.order}. {item.assetId.slice(0, 8)} · {(item.reasons || []).join(", ")}
                {quote.debug.transmittedAssetIds?.includes(item.assetId)
                  ? " · transmitted"
                  : " · manifest only"}
              </li>
            ))}
          </ol>
          {quote.debug.limitation && <p>{quote.debug.limitation}</p>}
          <pre>{JSON.stringify(quote.debug, null, 2)}</pre>
        </div>
      )}
      {capabilities?.uiHint && <p>{capabilities.uiHint}</p>}
      {capabilities?.previewOnly && (
        <p>
          Mock produces a playable test slate. It does not simulate Marcus or
          change character locks.
        </p>
      )}
      <p aria-live="polite">
        {isManualProvider ? "Film Studio charge: " : "Estimated render cost: "}
        <b>{quote ? `$${quote.estimatedCost.toFixed(2)}` : "Checking…"}</b>
        {quote && !isManualProvider &&
          ` · Session ceiling $${quote.policy.sessionCeiling.toFixed(2)} · Project ceiling $${quote.policy.projectCeiling.toFixed(2)}`}
      </p>
      {liveBlock && <div className="validation">{liveBlock}</div>}
      {error && (
        <div role="alert" className="validation">
          {error}
        </div>
      )}
      {isDrawThingsLocal ? (
        <div className="manualProviderCard">
          <b>Draw Things local handoff</b>
          <ol>
            <li>Download the selected identity and wardrobe references below.</li>
            <li>In Draw Things, select Realistic Vision v5.1 (8-bit) and keep Cloud Compute off.</li>
            <li>Import the references, paste both prompts, and generate one still locally.</li>
            <li>Save the approved PNG or JPEG, then use Upload completed take below.</li>
          </ol>
          <div className="buttonRow">
            <button className="primary" disabled={!quote} onClick={() => copyDrawThingsText("prompt", "Prompt")}>
              Copy Draw Things prompt
            </button>
            <button className="ghost" disabled={!quote} onClick={() => copyDrawThingsText("negativePrompt", "Negative prompt")}>
              Copy negative prompt
            </button>
            {drawThingsReferences().map((reference, index) => (
              <button
                className="ghost"
                key={reference.key}
                disabled={!quote}
                onClick={() => downloadReference(
                  reference,
                  `draw-things-reference-${index + 1}`,
                  `${reference.label} downloaded for Draw Things.`,
                )}
              >
                Download ref {index + 1}
              </button>
            ))}
            <button className="ghost" disabled={!quote} onClick={downloadDrawThingsHandoff}>
              Download handoff
            </button>
          </div>
          <small>
            Runs in the installed Mac app. Film Studio sends no image bytes, uses no cloud credits, and charges $0.
          </small>
          {manualNotice && <p className="manualNotice" aria-live="polite">{manualNotice}</p>}
        </div>
      ) : isVibesManual ? (
        <div className="manualProviderCard">
          <b>Vibes browser handoff</b>
          <ol>
            <li>Open Vibes and upload the Primary Identity image shown above.</li>
            <li>Paste the Film Studio prompt and generate the clip in Vibes.</li>
            <li>Download the MP4, then use Upload completed take below.</li>
          </ol>
          <div className="buttonRow">
            <button className="primary" disabled={!quote} onClick={openVibes}>
              Open Vibes + copy prompt
            </button>
            <button className="ghost" disabled={!quote} onClick={copyVibesPrompt}>
              Copy prompt
            </button>
            <button className="ghost" disabled={!quote || !vibesReference()} onClick={downloadVibesReference}>
              Download reference
            </button>
            <button className="ghost" disabled={!quote} onClick={downloadVibesHandoff}>
              Download handoff
            </button>
          </div>
          <small>
            Vibes runs outside Film Studio. Its availability, moderation, and service limits are controlled by Meta.
          </small>
          {manualNotice && <p className="manualNotice" aria-live="polite">{manualNotice}</p>}
        </div>
      ) : (
        <button
          className="primary full"
          disabled={busy || !quote || Boolean(liveBlock)}
          onClick={generate}
        >
          {busy
            ? "Submitting…"
            : `Generate Take${quote ? ` · $${quote.estimatedCost.toFixed(2)}` : ""}`}
        </button>
      )}
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
            {r.debug?.characterReferenceSelection && (
              <pre className="mockDebug">
                {JSON.stringify(
                  {
                    selectedAssetIds: r.debug.selectedAssetIds,
                    transmittedAssetIds: r.debug.transmittedAssetIds,
                    lockVersions: r.debug.lockVersions,
                    selectionReasons: r.debug.selectionReasons,
                    fallbackApplied: r.debug.fallbackApplied,
                    limitation: r.debug.limitation,
                  },
                  null,
                  2,
                )}
              </pre>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
