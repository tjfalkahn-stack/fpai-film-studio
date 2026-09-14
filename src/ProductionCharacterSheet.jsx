import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Crop, Grid3X3, RotateCcw, Trash2, Upload } from "lucide-react";
import {
  CHARACTER_SHEET_LABELS,
  FPAI_EXPRESSION_BANK_SIZE,
  SHEET_EXPRESSION_NAMES,
  characterSheetCropPixels,
  createCustomCharacterSheetCell,
  defaultCharacterSheetCells,
  fpaiCharacterBibleCells,
  isFpaiCharacterBibleDimensions,
  isLowResolutionReferenceCrop,
  normalizeDrawnSheetBounds,
  pickCharacterSheetFile,
} from "./characterSheets.js";
import {
  applyCommittedSheetLabels,
  commitCharacterSheet,
  fetchCharacterSheets,
  ingestCharacterSheet,
  updateCharacterSheet,
} from "./characterSheetClient.js";

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function cropPreviewStyle(source, cell) {
  if (!source) return {};
  const width = Math.max(0.01, Number(cell.width) || 0.01);
  const height = Math.max(0.01, Number(cell.height) || 0.01);
  const horizontal = width >= 1 ? 0 : clamp(Number(cell.x)) / (1 - width) * 100;
  const vertical = height >= 1 ? 0 : clamp(Number(cell.y)) / (1 - height) * 100;
  return {
    backgroundImage: `url("${String(source).replaceAll('"', "%22")}")`,
    backgroundSize: `${100 / width}% ${100 / height}%`,
    backgroundPosition: `${horizontal}% ${vertical}%`,
  };
}

async function loadImage(source) {
  const url = source instanceof Blob ? URL.createObjectURL(source) : source;
  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("The character sheet image could not be opened for cropping."));
      image.src = url;
    });
    return image;
  } finally {
    if (source instanceof Blob) URL.revokeObjectURL(url);
  }
}

async function cropPanel(source, cell, filename) {
  const image = await loadImage(source);
  const sx = Math.round(cell.x * image.naturalWidth);
  const sy = Math.round(cell.y * image.naturalHeight);
  const sw = Math.max(1, Math.round(cell.width * image.naturalWidth));
  const sh = Math.max(1, Math.round(cell.height * image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d", { alpha: false }).drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  const type = "image/jpeg";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.94));
  if (!blob) throw new Error("A selected character sheet panel could not be prepared.");
  return new File([blob], `${filename.replace(/\.[^.]+$/, "")}-${cell.id}.jpg`, { type });
}

async function normalizedSheetVersion(source, filename) {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0);
  const requestedType = source.type === "image/webp" ? "image/jpeg" : "image/webp";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, requestedType, 1));
  if (!blob) throw new Error("The stored Character Bible could not be prepared for a repair version.");
  const type = blob.type || requestedType;
  const extension = type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg";
  return new File([blob], `${filename.replace(/\.[^.]+$/, "")}-expression-bank.${extension}`, {
    type,
    lastModified: Date.now(),
  });
}

export default function ProductionCharacterSheet({ projectId, character, onLibrarySync, notify }) {
  const input = useRef(null);
  const canvas = useRef(null);
  const [sheets, setSheets] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [sourceFile, setSourceFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [drawing, setDrawing] = useState(null);
  const [redrawCell, setRedrawCell] = useState(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const cells = sheet?.cells || [];
  const previewUrl = useMemo(() => sourceFile ? URL.createObjectURL(sourceFile) : sheet?.assetUrl || "", [sourceFile, sheet?.assetUrl]);
  const committed = sheet?.status === "committed" || sheet?.status === "archived";
  const fpaiSourceCompatible = isFpaiCharacterBibleDimensions(
    sheet?.width || sheet?.manifest?.source?.width,
    sheet?.height || sheet?.manifest?.source?.height,
  );
  const drawnBounds = drawing ? normalizeDrawnSheetBounds(drawing.start, drawing.end, 0) : null;

  useEffect(() => () => {
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    let canceled = false;
    setSheet(null);
    setSheets([]);
    setSourceFile(null);
    setCustomMode(false);
    setDrawing(null);
    setRedrawCell(null);
    setReviewConfirmed(false);
    setError("");
    setStatus("Checking for a saved character sheet…");
    fetchCharacterSheets(projectId, character.id).then((payload) => {
      if (canceled) return;
      setSheets(payload.sheets || []);
      setSheet((payload.sheets || []).find((item) => item.status === "draft") || (payload.sheets || [])[0] || null);
      setStatus("");
    }).catch((err) => {
      if (canceled) return;
      setError(err.message);
      setStatus("");
    });
    return () => { canceled = true; };
  }, [projectId, character.id]);

  async function ingest(candidate) {
    const file = pickCharacterSheetFile([candidate]);
    if (!file) {
      setError("Choose a JPG, PNG, or WebP character sheet.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus(`Uploading ${file.name}…`);
    setProgress(0);
    try {
      const image = await loadImage(file);
      const fpaiLayout = isFpaiCharacterBibleDimensions(image.naturalWidth, image.naturalHeight);
      const proposedCells = fpaiLayout ? fpaiCharacterBibleCells(character) : defaultCharacterSheetCells();
      const payload = await ingestCharacterSheet(
        projectId,
        character.id,
        file,
        proposedCells,
        { onProgress: setProgress },
      );
      setSourceFile(file);
      setSheet(payload.sheet);
      setSheets(payload.sheets || [payload.sheet]);
      setCustomMode(false);
      setDrawing(null);
      setRedrawCell(null);
      setReviewConfirmed(false);
      setStatus(payload.reused
        ? "This source sheet was already stored. Review its crops below."
        : fpaiLayout
          ? "FPAI Bible layout detected. Six expression panels are ready for review; confirm the boxes, then commit."
          : "Source sheet stored. Review every crop before committing.");
      notify?.("Character sheet uploaded. Review the crop boxes and labels before committing it.");
    } catch (err) {
      setError(err.message);
      setStatus("Upload stopped. Nothing was committed.");
    } finally {
      setBusy(false);
    }
  }

  function receiveFiles(fileList) {
    const file = pickCharacterSheetFile(fileList);
    if (!file) {
      setError("Choose a JPG, PNG, or WebP character sheet.");
      return;
    }
    void ingest(file);
  }

  function dropSheet(event) {
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    if (!busy) receiveFiles(event.dataTransfer.files);
  }

  function changeCell(id, patch) {
    setReviewConfirmed(false);
    setSheet((current) => ({
      ...current,
      cells: current.cells.map((cell) => cell.id === id ? { ...cell, ...patch, assetId: null } : cell),
    }));
  }

  function applyGrid(columns, rows) {
    setReviewConfirmed(false);
    setSheet((current) => ({ ...current, cells: defaultCharacterSheetCells(columns, rows) }));
    setCustomMode(false);
    setDrawing(null);
    setRedrawCell(null);
    setStatus(`${columns}×${rows} grid applied. Confirm every crop and label.`);
  }

  function applyFpaiLayout() {
    setReviewConfirmed(false);
    setSheet((current) => ({ ...current, cells: fpaiCharacterBibleCells(character) }));
    setCustomMode(false);
    setDrawing(null);
    setRedrawCell(null);
    setStatus("FPAI Bible layout applied: six expression panels plus identity, profile, full body, wardrobe, and three-quarter references. Review, then commit.");
  }

  function startCustomLayout() {
    setReviewConfirmed(false);
    setSheet((current) => ({ ...current, cells: [] }));
    setCustomMode(true);
    setDrawing(null);
    setRedrawCell(null);
    setStatus("Custom layout active. Drag a box around each useful image in the Bible.");
  }

  function addCustomCrop() {
    setReviewConfirmed(false);
    setCustomMode(true);
    setDrawing(null);
    setRedrawCell(null);
    setStatus("Drag a box around the next useful image.");
  }

  function pointFromEvent(event) {
    const bounds = canvas.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds?.height) return null;
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  }

  function beginDrawing(event) {
    if (!customMode || busy || committed || (event.button != null && event.button !== 0)) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrawing({ start: point, end: point });
  }

  function continueDrawing(event) {
    if (!drawing || !customMode) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    setDrawing((current) => current ? { ...current, end: point } : current);
  }

  function finishDrawing(event) {
    if (!drawing || !customMode) return;
    const point = pointFromEvent(event) || drawing.end;
    const bounds = normalizeDrawnSheetBounds(drawing.start, point);
    setDrawing(null);
    if (!bounds) {
      setStatus("That box was too small. Drag around the full image panel.");
      return;
    }
    setSheet((current) => {
      const base = current.cells || [];
      const next = createCustomCharacterSheetCell(base, bounds, redrawCell || {});
      return { ...current, cells: [...base, next] };
    });
    setReviewConfirmed(false);
    setRedrawCell(null);
    setStatus("Crop added. Check its label below, then draw another or finish drawing.");
  }

  function redraw(cell) {
    setReviewConfirmed(false);
    setSheet((current) => ({ ...current, cells: current.cells.filter((item) => item.id !== cell.id) }));
    setRedrawCell({ id: cell.id, label: cell.label, included: cell.included });
    setCustomMode(true);
    setDrawing(null);
    setStatus(`Redraw panel ${cell.id.replace("cell-", "")}: drag a new box around the image.`);
  }

  function removeCell(id) {
    setReviewConfirmed(false);
    setSheet((current) => ({ ...current, cells: current.cells.filter((cell) => cell.id !== id) }));
    setStatus("Crop removed from this draft. The source Bible is unchanged.");
  }

  async function saveReview() {
    if (!cells.length) {
      setError("Draw at least one crop before saving the review.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Saving crop corrections…");
    try {
      const payload = await updateCharacterSheet(projectId, character.id, sheet.id, cells);
      setSheet(payload.sheet);
      setStatus("Crop corrections saved. No references were committed yet.");
      notify?.("Character sheet review saved.");
    } catch (err) {
      setError(err.message);
      setStatus("Save stopped. The previous draft remains available.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!reviewConfirmed) {
      setError("Confirm that you reviewed every crop and label before committing this Character Sheet.");
      return;
    }
    const lowResolutionReferences = cells.filter((cell) => isLowResolutionReferenceCrop(sheet, cell));
    if (lowResolutionReferences.length) {
      const panels = lowResolutionReferences.map((cell) => cell.id.replace("cell-", "")).join(", ");
      setError(`Reference panel${lowResolutionReferences.length === 1 ? "" : "s"} ${panels} ${lowResolutionReferences.length === 1 ? "is" : "are"} below the 512×512 minimum. Uncheck Use for those crops and upload full-resolution individual photos in the Reference Library.`);
      return;
    }
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const source = sourceFile || await fetch(sheet.assetUrl).then((response) => {
        if (!response.ok) throw new Error("The stored character sheet could not be loaded.");
        return response.blob();
      });
      const selected = cells.filter((cell) => cell.included);
      const crops = [];
      let completed = 0;
      for (const cell of cells) {
        if (!cell.included) continue;
        setStatus(`Preparing reference ${completed + 1} of ${selected.length}…`);
        const crop = await cropPanel(source, cell, sheet.filename);
        crops.push({ id: cell.id, file: crop });
        completed += 1;
        setProgress(0.5 * completed / selected.length);
      }
      setStatus("Uploading reviewed crops and committing reference assignments together…");
      const payload = await commitCharacterSheet(projectId, character.id, sheet.id, cells.map((cell) => ({ ...cell, assetId: null })), {
        crops, wardrobe: character.wardrobe, onProgress: (value) => setProgress(0.5 + value * 0.5),
      });
      setSheet(payload.sheet);
      setSheets((current) => [payload.sheet, ...current.filter((item) => item.id !== payload.sheet.id)]);
      setCustomMode(false);
      setProgress(1);
      setStatus(`Production Character Sheet v${payload.sheet.version} committed. No paid generation was started.`);
      onLibrarySync?.(payload);
      notify?.(`Production Character Sheet v${payload.sheet.version} committed. Rebuild the Character Lock when ready.`);
    } catch (err) {
      setError(err.message);
      setStatus("Commit was not confirmed. The source draft remains recoverable; refresh to check whether the commit completed before retrying. No paid render was started.");
    } finally {
      setBusy(false);
    }
  }

  async function applyLabels() {
    setBusy(true);
    setError("");
    setStatus("Applying this committed sheet’s labels to its stored references…");
    try {
      const payload = await applyCommittedSheetLabels(projectId, character.id, sheet.id);
      onLibrarySync?.(payload);
      setStatus("Committed labels applied. Required slots, expressions, and coverage are synchronized. No generation was started.");
      notify?.("Committed reference labels applied. Existing images and sheet versions were preserved.");
    } catch (err) {
      setError(err.message);
      setStatus("Labels were not applied. Existing references were preserved.");
    } finally {
      setBusy(false);
    }
  }

  async function reprocessExpressionBank() {
    if (!fpaiSourceCompatible) {
      setError("Automatic six-panel extraction is available only for the single-page 5:6 FPAI Bible layout. This source uses a different layout; create custom crops or upload individual expression portraits instead.");
      setStatus("No repair draft was created and every existing reference remains unchanged.");
      return;
    }
    setBusy(true);
    setError("");
    setProgress(0);
    setStatus("Preparing a new repair version from the stored Character Bible…");
    try {
      const response = await fetch(sheet.assetUrl);
      if (!response.ok) throw new Error("The stored Character Bible could not be loaded.");
      const source = await response.blob();
      const file = await normalizedSheetVersion(source, sheet.filename);
      const payload = await ingestCharacterSheet(
        projectId,
        character.id,
        file,
        fpaiCharacterBibleCells(character),
        { onProgress: setProgress },
      );
      setSourceFile(file);
      setSheet(payload.sheet);
      setSheets(payload.sheets || [payload.sheet]);
      setCustomMode(false);
      setDrawing(null);
      setRedrawCell(null);
      setReviewConfirmed(false);
      if (payload.sheet.status === "draft") {
        setStatus("Repair version ready. The six expression crops are outlined below; review them, then click Commit Character Sheet.");
        notify?.("Six-expression repair draft created from the stored Bible. No images were generated and no paid service was called.");
        return;
      }
      const expressionCount = new Set((payload.sheet.manifest?.panels || []).map((panel) => SHEET_EXPRESSION_NAMES[panel.label]).filter(Boolean)).size;
      if (expressionCount !== FPAI_EXPRESSION_BANK_SIZE) {
        throw new Error("A repair version could not be created from this source. The existing committed Bible was left unchanged.");
      }
      const synced = await applyCommittedSheetLabels(projectId, character.id, payload.sheet.id);
      onLibrarySync?.(synced);
      setStatus("The six-expression version already existed, so its Expression Bank labels were reapplied.");
      notify?.("Six-expression bank synchronized from the stored Character Bible.");
    } catch (err) {
      setError(err.message);
      setStatus("Expression extraction stopped. The committed Bible and every existing reference remain unchanged.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="productionSheet">
      <div className="sectionTitle"><Grid3X3 /><span>PRODUCTION CHARACTER SHEET</span></div>
      <p className="dropHint">Upload one Character Bible, confirm the crop around each useful image, then commit it. Grid and custom layouts are supported.</p>
      {!sheet && (
        <button
          type="button"
          className={`sheetUpload ${dropActive ? "dragging" : ""}`}
          disabled={busy}
          onClick={() => input.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); setDropActive(true); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDropActive(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropActive(false); }}
          onDrop={dropSheet}
        >
          <Upload /><b>{busy ? "Uploading character sheet…" : "Click or drop one character sheet"}</b><small>JPG, PNG, or WebP · regular grids and detailed custom Bibles</small>
        </button>
      )}
      <input ref={input} className="hiddenInput" type="file" accept={ACCEPT} onChange={(event) => { receiveFiles(event.target.files); event.target.value = ""; }} />
      {sheet && (
        <>
          <div className="sheetHead">
            <div><b>{sheet.filename}</b><small>Version {sheet.version} · {sheet.status}</small></div>
            <button type="button" className="ghost compact" disabled={busy} onClick={() => input.current?.click()}>Upload new version</button>
          </div>
          <div className="sheetPreview">
            <div
              ref={canvas}
              className={`sheetCanvas ${customMode && !committed ? "drawing" : ""}`}
              onPointerDown={beginDrawing}
              onPointerMove={continueDrawing}
              onPointerUp={finishDrawing}
              onPointerCancel={() => setDrawing(null)}
            >
              <img src={previewUrl} alt={`${character.name} production character sheet`} draggable="false" />
              {cells.map((cell) => (
                <i key={cell.id} className={cell.included ? "" : "excluded"} style={{ left: `${cell.x * 100}%`, top: `${cell.y * 100}%`, width: `${cell.width * 100}%`, height: `${cell.height * 100}%` }}>
                  <span>{cell.id.replace("cell-", "")}</span>
                </i>
              ))}
              {drawnBounds && <i className="drawingBox" style={{ left: `${drawnBounds.x * 100}%`, top: `${drawnBounds.y * 100}%`, width: `${drawnBounds.width * 100}%`, height: `${drawnBounds.height * 100}%` }} />}
            </div>
          </div>
          {!committed && (
            <div className="sheetTemplates">
              <span>Crop layout</span>
              <button type="button" className="ghost compact" disabled={busy} onClick={() => applyGrid(2, 3)}>2×3</button>
              <button type="button" className="ghost compact" disabled={busy} onClick={() => applyGrid(3, 3)}>3×3</button>
              <button type="button" className="ghost compact" disabled={busy} onClick={() => applyGrid(4, 3)}>4×3</button>
              <button type="button" className="ghost compact" disabled={busy} onClick={applyFpaiLayout}><Grid3X3 /> FPAI Bible · 6 expressions</button>
              <button type="button" className="ghost compact" disabled={busy} onClick={startCustomLayout}><Crop /> Custom layout</button>
            </div>
          )}
          {customMode && !committed && (
            <div className="customCropHelp">
              <Crop />
              <span>Drag directly over one useful image at a time. Draw Identity Front, Profile, Full Body, an Expression, and Wardrobe first.</span>
              <button type="button" className="ghost compact" onClick={() => setCustomMode(false)}>Finish drawing</button>
            </div>
          )}
          <div className="sheetCells">
            {cells.map((cell) => {
              const size = characterSheetCropPixels(sheet, cell);
              const lowResolution = isLowResolutionReferenceCrop(sheet, cell);
              return (
              <div className={`${cell.included ? "sheetCell" : "sheetCell excluded"}${lowResolution ? " lowResolution" : ""}`} key={cell.id}>
                <span className="sheetCellThumb" style={cropPreviewStyle(previewUrl, cell)} aria-hidden="true" />
                <span className="sheetCellTitle"><b>Panel {cell.id.replace("cell-", "")}</b>{size.width > 0 && <small>{size.width}×{size.height}{lowResolution ? " · too small" : ""}</small>}</span>
                <select disabled={busy || committed} value={cell.label} onChange={(event) => changeCell(cell.id, { label: event.target.value, included: event.target.value !== "exclude" })}>
                  {CHARACTER_SHEET_LABELS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
                <label><input type="checkbox" disabled={busy || committed} checked={cell.included} onChange={(event) => changeCell(cell.id, { included: event.target.checked })} /> Use</label>
                {!committed && <button type="button" className="iconButton cropAction" title="Redraw this crop" disabled={busy} onClick={() => redraw(cell)}><RotateCcw /></button>}
                {!committed && <button type="button" className="iconButton cropAction" title="Remove this crop" disabled={busy} onClick={() => removeCell(cell.id)}><Trash2 /></button>}
              </div>
              );
            })}
            {!cells.length && <p className="sub">No crops yet. Drag boxes over the useful images in the Bible.</p>}
          </div>
          {!committed && !customMode && cells.length < 20 && (
            <button type="button" className="ghost compact addCrop" disabled={busy} onClick={addCustomCrop}><Crop /> Add a custom crop</button>
          )}
          {committed ? (
            <>
              <p className="sheetCommitted"><CheckCircle2 /> Version {sheet.version} is committed with {sheet.manifest?.panels?.length || 0} usable references.</p>
              {sheet.status === "committed" && <>
                <button type="button" className="ghost" disabled={busy} onClick={applyLabels}>Apply committed labels</button>
                <p className="sub">Use this to repair an earlier import or explicitly reselect this sheet’s required slots and matching expression images. Other images are preserved.</p>
                <button type="button" className="primary full sheetRepair" disabled={busy || !fpaiSourceCompatible} onClick={reprocessExpressionBank}><Grid3X3 /> Extract 6 Expression Panels</button>
                <p className="sub">{fpaiSourceCompatible ? "For the single-page 5:6 FPAI Bible only. Creates a reviewable version and does not generate images, call a paid provider, or change the committed version." : "Unavailable for this source layout. Use custom crops or full-resolution individual expression portraits; no existing references are changed."}</p>
              </>}
            </>
          ) : (
            <>
              <label className="sheetReviewConfirm">
                <input type="checkbox" disabled={busy || !cells.length} checked={reviewConfirmed} onChange={(event) => { setReviewConfirmed(event.target.checked); setError(""); }} />
                <span><b>I reviewed every crop and label.</b><small>Each Expression preview shows one face—not a full sheet, body panel, or detail collage.</small></span>
              </label>
              <div className="buttonRow">
                <button type="button" className="ghost" disabled={busy || !cells.length} onClick={saveReview}>Save corrections</button>
                <button type="button" className="primary" disabled={busy || !reviewConfirmed || !cells.some((cell) => cell.included)} onClick={commit}>Commit Character Sheet</button>
              </div>
            </>
          )}
          {sheets.length > 1 && <p className="sub">{sheets.length} sheet versions preserved. Older committed versions remain available in their manifests.</p>}
        </>
      )}
      {(busy || progress > 0 && progress < 1) && (
        <div className="sheetProgress" aria-live="polite"><i><em style={{ width: `${Math.round(progress * 100)}%` }} /></i><span>{Math.round(progress * 100)}%</span></div>
      )}
      {status && <p className="sheetStatus" aria-live="polite">{status}</p>}
      {error && <div className="validation" role="alert">{error}</div>}
    </section>
  );
}
