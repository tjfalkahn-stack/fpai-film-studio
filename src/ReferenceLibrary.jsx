import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  LockKeyhole,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  EXPRESSION_TAGS,
  REFERENCE_ANGLES,
  REFERENCE_CATEGORIES,
  evaluateReferenceCoverage,
  migrateLegacyCharacterRefs,
} from "./characterReferences.js";
import {
  deleteCharacterReference,
  fetchCharacterLibrary,
  patchCharacterLibrary,
  patchCharacterReference,
  rebuildCharacterLock,
  uploadCharacterReference,
} from "./characterReferenceClient.js";

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

function title(value) {
  return String(value || "").replaceAll("_", " ");
}

function CoveragePanel({ coverage }) {
  if (!coverage) return null;
  const percent = Math.round((coverage.score || 0) * 100);
  return (
    <div className="coveragePanel">
      <div className="lockProgress">
        <b>{coverage.metCount}/{coverage.total}</b>
        <span>Reference Coverage · {percent}%</span>
      </div>
      <div className="progressTrack"><i style={{ width: `${percent}%` }} /></div>
      <p className="sub">{coverage.disclaimer}</p>
      {coverage.missing.length ? (
        <ul className="coverageMissing">
          {coverage.missing.map((item) => <li key={item}>Missing · {item}</li>)}
        </ul>
      ) : (
        <p className="good">All coverage checks are present. This still does not guarantee model consistency.</p>
      )}
    </div>
  );
}

export default function ReferenceLibrary({
  projectId,
  character,
  getMedia,
  dragTarget,
  setDragTarget,
  onLibrarySync,
  notify,
}) {
  const [assets, setAssets] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [lock, setLock] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [filters, setFilters] = useState({ category: "", angle: "", expression: "", wardrobe: "" });
  const [selected, setSelected] = useState([]);
  const [preview, setPreview] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState({ category: "", expression: "", angle: "" });
  const migrated = useRef(false);
  const fileInput = useRef(null);

  function applyPayload(payload) {
    if (payload.references) setAssets(payload.references);
    if (payload.coverage) setCoverage(payload.coverage);
    if (payload.lock !== undefined) setLock(payload.lock);
    if (payload.reference && payload.coverage) {
      setAssets((current) => {
        const next = current.some((item) => item.id === payload.reference.id)
          ? current.map((item) => (item.id === payload.reference.id ? payload.reference : item))
          : [...current, payload.reference];
        return next;
      });
    }
    onLibrarySync?.(payload);
  }

  async function refresh() {
    const payload = await fetchCharacterLibrary(projectId, character.id);
    setAssets(payload.references || []);
    setCoverage(payload.coverage || evaluateReferenceCoverage(payload.references || []));
    setLock(payload.lock || null);
    onLibrarySync?.(payload);
    return payload;
  }

  useEffect(() => {
    let canceled = false;
    setError("");
    fetchCharacterLibrary(projectId, character.id)
      .then((payload) => {
        if (canceled) return;
        setAssets(payload.references || []);
        setCoverage(payload.coverage || null);
        setLock(payload.lock || null);
        onLibrarySync?.(payload);
      })
      .catch((err) => {
        if (!canceled) setError(err.message);
      });
    return () => {
      canceled = true;
    };
  }, [projectId, character.id]);

  useEffect(() => {
    if (migrated.current) return undefined;
    migrated.current = true;
    const pending = migrateLegacyCharacterRefs(character).filter(
      (entry) => !(character.migratedMediaKeys || []).includes(entry.mediaKey),
    );
    if (!pending.length) return undefined;
    let canceled = false;
    (async () => {
      const migratedKeys = [...(character.migratedMediaKeys || [])];
      for (const entry of pending) {
        const file = await getMedia(entry.mediaKey);
        if (!file || canceled) continue;
        try {
          await uploadCharacterReference(projectId, character.id, file, {
            filename: entry.filename,
            category: entry.category,
            angle: entry.angle,
            expression: entry.expression,
            wardrobe: entry.wardrobe,
            isPrimary: entry.isPrimary,
            isIdentityAnchor: entry.isIdentityAnchor,
            approvalState: entry.approvalState,
          });
          migratedKeys.push(entry.mediaKey);
        } catch (err) {
          if (err.status === 409) migratedKeys.push(entry.mediaKey);
          else if (!canceled) setError(err.message);
        }
      }
      if (!canceled) {
        onLibrarySync?.({ migratedMediaKeys: migratedKeys });
        await refresh().catch((err) => setError(err.message));
      }
    })();
    return () => {
      canceled = true;
    };
  }, [character.id]);

  const wardrobeOptions = useMemo(
    () => [...new Set(assets.map((item) => item.wardrobe).filter(Boolean))],
    [assets],
  );

  const visible = assets.filter((asset) => {
    if (filters.category && asset.category !== filters.category) return false;
    if (filters.angle && asset.angle !== filters.angle) return false;
    if (filters.expression && asset.expression !== filters.expression) return false;
    if (filters.wardrobe && asset.wardrobe !== filters.wardrobe) return false;
    return true;
  });

  function queueFiles(fileList) {
    const files = [...fileList].filter(Boolean);
    if (!files.length) return;
    const items = files.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(16).slice(2)}`,
      file,
      name: file.name,
      status: "queued",
      progress: 0,
      error: "",
    }));
    setUploads((current) => [...items, ...current]);
    items.forEach((item) => runUpload(item));
  }

  async function runUpload(item) {
    setUploads((current) => current.map((row) => (row.id === item.id ? { ...row, status: "uploading", error: "" } : row)));
    try {
      const payload = await uploadCharacterReference(
        projectId,
        character.id,
        item.file,
        { category: "other" },
        {
          onProgress: (progress) => {
            setUploads((current) => current.map((row) => (row.id === item.id ? { ...row, progress } : row)));
          },
        },
      );
      setUploads((current) => current.map((row) => (row.id === item.id ? { ...row, status: "done", progress: 1 } : row)));
      applyPayload(payload);
      notify?.(`Uploaded ${item.name}`);
    } catch (err) {
      setUploads((current) =>
        current.map((row) => (row.id === item.id ? { ...row, status: "error", error: err.message } : row)),
      );
      setError(err.message);
    }
  }

  async function updateAsset(asset, patch) {
    setBusy(true);
    setError("");
    try {
      applyPayload(await patchCharacterReference(projectId, character.id, asset.id, patch));
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function bulkPatch(patch) {
    if (!selected.length) return;
    setBusy(true);
    setError("");
    try {
      applyPayload(await patchCharacterLibrary(projectId, character.id, { ids: selected, patch }));
      await refresh();
      notify?.(`Updated ${selected.length} references`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function move(asset, direction) {
    const ids = assets.map((item) => item.id);
    const index = ids.indexOf(asset.id);
    const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    const orderedIds = [...ids];
    orderedIds.splice(index, 1);
    orderedIds.splice(next, 0, asset.id);
    setBusy(true);
    try {
      applyPayload(await patchCharacterLibrary(projectId, character.id, { orderedIds }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const asset = pendingDelete;
    if (!asset) return;
    setBusy(true);
    try {
      await deleteCharacterReference(projectId, character.id, asset.id);
      setPendingDelete(null);
      setSelected((current) => current.filter((id) => id !== asset.id));
      await refresh();
      notify?.("Reference removed. Character assignments and existing shots were not changed.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function rebuild() {
    setBusy(true);
    setError("");
    try {
      const payload = await rebuildCharacterLock(projectId, character.id);
      setLock(payload.lock);
      setCoverage(payload.coverage);
      notify?.(`Character lock v${payload.lock.lockVersion} rebuilt. No paid training was started.`);
      onLibrarySync?.(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const dropKey = `library:${character.id}`;

  return (
    <section className="referenceLibrary">
      <div className="sectionTitle"><Upload /><span>REFERENCE LIBRARY</span></div>
      <p className="dropHint">Add extra photos or variants here after committing a Production Character Sheet. Each extra file remains independently selectable.</p>
      <CoveragePanel coverage={coverage} />
      {lock && (
        <p className={lock.needsRebuild || lock.status === "stale" ? "warn" : "good"}>
          Identity lock v{lock.lockVersion} · {lock.status}{lock.needsRebuild ? " · rebuild required after reference changes" : ""}
        </p>
      )}
      <div
        className={`libraryDropzone dropzone ${dragTarget === dropKey ? "dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragTarget(dropKey); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragTarget(null); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragTarget(null);
          queueFiles(event.dataTransfer.files);
        }}
      >
        <Upload />
        <b>Drop JPG, PNG, or WebP files</b>
        <small>Multi-select is supported. Failed uploads can be retried without changing the character record.</small>
        <button type="button" className="ghost compact" onClick={() => fileInput.current?.click()}>Select images</button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          onChange={(event) => {
            queueFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {uploads.filter((item) => item.status !== "done").length > 0 && (
        <div className="uploadQueue">
          {uploads.filter((item) => item.status !== "done").map((item) => (
            <div className="uploadRow" key={item.id}>
              <span>{item.name}</span>
              <i><em style={{ width: `${Math.round((item.progress || 0) * 100)}%` }} /></i>
              <small className={item.status === "error" ? "bad" : ""}>{item.error || item.status}</small>
              {item.status === "error" && <button type="button" className="ghost compact" onClick={() => runUpload(item)}>Retry</button>}
            </div>
          ))}
        </div>
      )}
      <div className="libraryFilters">
        <label>Category
          <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}>
            <option value="">All</option>
            {REFERENCE_CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label>Angle
          <select value={filters.angle} onChange={(event) => setFilters((current) => ({ ...current, angle: event.target.value }))}>
            <option value="">All</option>
            {REFERENCE_ANGLES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label>Expression
          <select value={filters.expression} onChange={(event) => setFilters((current) => ({ ...current, expression: event.target.value }))}>
            <option value="">All</option>
            {EXPRESSION_TAGS.map((item) => <option key={item} value={item}>{title(item)}</option>)}
          </select>
        </label>
        <label>Wardrobe
          <select value={filters.wardrobe} onChange={(event) => setFilters((current) => ({ ...current, wardrobe: event.target.value }))}>
            <option value="">All</option>
            {wardrobeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      {selected.length > 0 && (
        <div className="bulkBar">
          <span>{selected.length} selected</span>
          <select value={bulk.category} onChange={(event) => setBulk((current) => ({ ...current, category: event.target.value }))}>
            <option value="">Set category</option>
            {REFERENCE_CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <select value={bulk.expression} onChange={(event) => setBulk((current) => ({ ...current, expression: event.target.value }))}>
            <option value="">Set expression</option>
            {EXPRESSION_TAGS.map((item) => <option key={item} value={item}>{title(item)}</option>)}
          </select>
          <select value={bulk.angle} onChange={(event) => setBulk((current) => ({ ...current, angle: event.target.value }))}>
            <option value="">Set angle</option>
            {REFERENCE_ANGLES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <button type="button" className="ghost compact" disabled={busy} onClick={() => bulkPatch({
            ...(bulk.category ? { category: bulk.category } : {}),
            ...(bulk.expression ? { expression: bulk.expression } : {}),
            ...(bulk.angle ? { angle: bulk.angle } : {}),
          })}>Apply tags</button>
          <button type="button" className="ghost compact" disabled={busy} onClick={() => bulkPatch({ isIdentityAnchor: true, approvalState: "approved" })}>Approve identity anchors</button>
          <button type="button" className="ghost compact" disabled={busy} onClick={() => bulkPatch({ includeInGeneration: true, approvalState: "approved" })}>Include in generation</button>
          <button type="button" className="ghost compact" disabled={busy} onClick={() => bulkPatch({ includeInGeneration: false, approvalState: "excluded" })}>Exclude</button>
        </div>
      )}
      <div className="libraryGrid">
        {visible.map((asset) => (
          <article className={`libraryCard ${asset.isPrimary ? "primary" : ""} ${!asset.includeInGeneration ? "excluded" : ""}`} key={asset.id}>
            <label className="libraryCheck">
              <input
                type="checkbox"
                checked={selected.includes(asset.id)}
                onChange={(event) => setSelected((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))}
              />
            </label>
            <button type="button" className="libraryThumb" onClick={() => setPreview(asset)}>
              <img src={asset.assetUrl} alt={asset.filename} />
            </button>
            <b>{asset.filename}</b>
            <small>{asset.width}×{asset.height} · {title(asset.category)}</small>
            <div className="libraryTags">
              {asset.isPrimary && <span className="pill good">Primary</span>}
              {asset.isIdentityAnchor && asset.approvalState === "approved" && <span className="pill purple">Anchor</span>}
              {asset.expression && <span className="pill">{title(asset.expression)}</span>}
              {asset.angle && <span className="pill">{title(asset.angle)}</span>}
              {!asset.includeInGeneration && <span className="pill bad">Excluded</span>}
            </div>
            <div className="libraryActions">
              <button type="button" className="ghost compact" disabled={busy} onClick={() => updateAsset(asset, { isPrimary: true })}><Star /> Primary</button>
              <button type="button" className="ghost compact" disabled={busy} onClick={() => updateAsset(asset, { isIdentityAnchor: !asset.isIdentityAnchor, approvalState: "approved" })}>Anchor</button>
              <button type="button" className="ghost compact" disabled={busy} onClick={() => updateAsset(asset, { includeInGeneration: !asset.includeInGeneration, approvalState: asset.includeInGeneration ? "excluded" : "approved" })}>
                {asset.includeInGeneration ? "Exclude" : "Include"}
              </button>
              <button type="button" className="iconButton" title="Preview" onClick={() => setPreview(asset)}><Eye /></button>
              <button type="button" className="ghost compact" disabled={busy} onClick={() => move(asset, -1)}>Up</button>
              <button type="button" className="ghost compact" disabled={busy} onClick={() => move(asset, 1)}>Down</button>
              <button type="button" className="iconButton" title="Delete" onClick={() => setPendingDelete(asset)}><Trash2 /></button>
            </div>
            <div className="formGrid two compactForm">
              <label>Category
                <select value={asset.category} disabled={busy} onChange={(event) => updateAsset(asset, { category: event.target.value })}>
                  {REFERENCE_CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </label>
              <label>Expression
                <select value={asset.expression || ""} disabled={busy} onChange={(event) => updateAsset(asset, { expression: event.target.value })}>
                  <option value="">None</option>
                  {EXPRESSION_TAGS.map((item) => <option key={item} value={item}>{title(item)}</option>)}
                </select>
              </label>
            </div>
          </article>
        ))}
        {!visible.length && <p className="sub">No individual reference photos match these filters yet.</p>}
      </div>
      <button type="button" className="primary full" disabled={busy || !assets.length} onClick={rebuild}>
        <LockKeyhole /> Rebuild Character Lock
      </button>
      <p className="sub">Rebuild writes a versioned reference manifest only. It does not start paid model training or a live render.</p>
      {error && <div className="validation"><AlertTriangle /> {error}</div>}
      {preview && createPortal(
        <div className="overlay previewOverlay" onClick={() => setPreview(null)}>
          <div className="previewFrame" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="close" onClick={() => setPreview(null)}><X /></button>
            <img src={preview.assetUrl} alt={preview.filename} />
            <p>{preview.filename} · {preview.width}×{preview.height} · {preview.mimeType}</p>
          </div>
        </div>,
        document.body,
      )}
      {pendingDelete && createPortal(
        <div className="overlay previewOverlay">
          <div className="confirmCard">
            <CheckCircle2 />
            <h3>Delete this reference?</h3>
            <p>Remove {pendingDelete.filename} from {character.name}. Existing shots and character assignments stay intact.</p>
            <div className="buttonRow">
              <button type="button" className="ghost" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button type="button" className="primary" disabled={busy} onClick={confirmDelete}><Trash2 /> Delete image</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <p className="sub">{assets.length} individual images stored. Capacity 80 per character.</p>
    </section>
  );
}
