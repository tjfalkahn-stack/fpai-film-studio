import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Crop, Grid3X3, RotateCcw, Trash2, Upload } from "lucide-react";
import {
  CHARACTER_SHEET_LABELS,
  FPAI_CONTACT_SHEET_PANEL_COUNT,
  FPAI_EXPRESSION_BANK_SIZE,
  MAX_CHARACTER_SHEET_PANELS,
  SHEET_EXPRESSION_NAMES,
  characterSheetCropPixels,
  characterSheetSeparationPlan,
  createCustomCharacterSheetCell,
  defaultCharacterSheetCells,
  fpaiCharacterBibleCells,
  fpaiContactSheetCells,
  isFpaiCharacterBibleDimensions,
  isFpaiContactSheetDimensions,
  isLowResolutionReferenceCrop,
  isUnseparableReferenceCrop,
  normalizeDrawnSheetBounds,
  pickCharacterSheetFile,
} from "./characterSheets.js";
import {
  applyCommittedSheetLabels,
  clearActiveCharacterSheets,
  commitCharacterSheet,
  fetchCharacterSheets,
  ingestCharacterSheet,
  updateCharacterSheet,
} from "./characterSheetClient.js";

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const activeSheet = (items = []) => items.find((item) => item.status === "draft")
  || items.find((item) => item.status === "committed")
  || null;

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
  const separation = characterSheetSeparationPlan(
    { width: image.naturalWidth, height: image.naturalHeight },
    cell,
  );
  if (!separation.canSeparate) {
    throw new Error(`Panel ${cell.id.replace("cell-", "")} is too small to separate safely from this source sheet.`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = separation.output.width;
  canvas.height = separation.output.height;
  const context = canvas.getContext("2d", { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const type = "image/jpeg";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
  if (!blob) throw new Error("A selected character sheet panel could not be prepared.");
  const variant = String(cell.variant || cell.label || cell.id).replace(/[^a-zA-Z0-9_-]+/g, "-");
  return new File([blob], `${filename.replace(/\.[^.]+$/, "")}-${variant}.jpg`, { type });
}

async function normalizedSheetVersion(source, filename, suffix = "expression-bank") {
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
  return new File([blob], `${filename.replace(/\.[^.]+$/, "")}-${suffix}.${extension}`, {
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
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const cells = sheet?.cells || [];
  const previewUrl = useMemo(() => sourceFile ? URL.createObjectURL(sourceFile) : sheet?.assetUrl || "", [sourceFile, sheet?.assetUrl]);
  const committed = sheet?.status === "committed" || sheet?.status === "archived";
  const fpaiSourceCompatible = isFpaiCharacterBibleDimensions(
    sheet?.width || sheet?.manifest?.source?.width,
    sheet?.height || sheet?.manifest?.source?.height,
  );
  const contactSheetCompatible = isFpaiContactSheetDimensions(
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
    setRemoveConfirm(false);
    setError("");
    setStatus("Checking for a saved character sheet…");
    fetchCharacterSheets(projectId, character.id).then((payload) => {
      if (canceled) return;
      setSheets(payload.sheets || []);
      setSheet(activeSheet(payload.sheets));
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
      const contactLayout = isFpaiContactSheetDimensions(image.naturalWidth, image.naturalHeight);
      const fpaiLayout = isFpaiCharacterBibleDimensions(image.naturalWidth, image.naturalHeight);
      const proposedCells = contactLayout
        ? fpaiContactSheetCells(character)
        : fpaiLayout
          ? fpaiCharacterBibleCells(character)
          : defaultCharacterSheetCells();
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
        : contactLayout
          ? `FPAI v1.2 contact sheet detected. ${FPAI_CONTACT_SHEET_PANEL_COUNT} individual photos are ready for review and high-quality separation.`
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

  async function removeOldSheet() {
    setBusy(true);
    setError("");
    setStatus("Removing the old active Character Sheet…");
    try {
      const payload = await clearActiveCharacterSheets(projectId, character.id);
      const nextSheets = payload.sheets || [];
      setSheets(nextSheets);
      setSheet(activeSheet(nextSheets));
      setSourceFile(null);
      setCustomMode(false);
      setDrawing(null);
      setRedrawCell(null);
      setReviewConfirmed(false);
      setRemoveConfirm(false);
      setProgress(0);
      setStatus("Old Character Sheet removed. Your individual reference photos were preserved.");
      onLibrarySync?.(payload);
      notify?.("Old Production Character Sheet removed. Individual reference photos were preserved.");
    } catch (err) {
      setError(err.message);
      setStatus("The old Character Sheet was not removed. Your photos were not changed.");
    } finally {
      setBusy(false);
    }
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

  function applyContactSheetLayout() {
    setReviewConfirmed(false);
    setSheet((current) => ({ ...current, cells: fpaiContactSheetCells(character) }));
    setCustomMode(false);
    setDrawing(null);
    setRedrawCell(null);
    setStatus(`FPAI v1.2 layout applied: ${FPAI_CONTACT_SHEET_PANEL_COUNT} photos will be separated without headings or captions. Review, then commit.`);
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
    const unseparableReferences = cells.filter((cell) => isUnseparableReferenceCrop(sheet, cell));
    if (unseparableReferences.length) {
      const panels = unseparableReferences.map((cell) => cell.id.replace("cell-", "")).join(", ");
      setError(`Reference panel${unseparableReferences.length === 1 ? "" : "s"} ${panels} ${unseparableReferences.length === 1 ? "is" : "are"} too small to separate safely. Uncheck Use for only those panels or replace them with a larger source.`);
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
      const separationCount = selected.filter((cell) => characterSheetSeparationPlan(sheet, cell).needsSeparation).length;
      const crops = [];
      let completed = 0;
      for (const cell of cells) {
        if (!cell.included) continue;
        setStatus(`Separating reference ${completed + 1} of ${selected.length} at high quality…`);
        const crop = await cropPanel(source, cell, sheet.filename);
        crops.push({ id: cell.id, file: crop });
        completed += 1;
        setProgress(0.5 * completed / selected.length);
      }
      setStatus(`Uploading ${selected.length} individual references${separationCount ? ` (${separationCount} locally enhanced)` : ""} and committing assignments together…`);
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

  async function reprocessContactSheet() {
    if (!contactSheetCompatible) {
      setError("Automatic 26-photo separation is available only for the 2:3 FPAI Character Bible v1.2 contact-sheet layout.");
      setStatus("No repair draft was created and every existing reference remains unchanged.");
      return;
    }
    setBusy(true);
    setError("");
    setProgress(0);
    setStatus("Preparing a new 26-photo separation version from the stored Character Bible…");
    try {
      const response = await fetch(sheet.assetUrl);
      if (!response.ok) throw new Error("The stored Character Bible could not be loaded.");
      const source = await response.blob();
      const file = await normalizedSheetVersion(source, sheet.filename, "contact-sheet-separation");
      const payload = await ingestCharacterSheet(
        projectId,
        character.id,
        file,
        fpaiContactSheetCells(character),
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
        setStatus(`${FPAI_CONTACT_SHEET_PANEL_COUNT}-photo repair version ready. Review the individual crops, then commit.`);
        notify?.("FPAI v1.2 separation draft created. No paid service was called and the committed version was preserved.");
        return;
      }
      if ((payload.sheet.manifest?.panels || []).length !== FPAI_CONTACT_SHEET_PANEL_COUNT) {
        throw new Error("A complete 26-photo repair version could not be created. The existing committed Bible was left unchanged.");
      }
      const synced = await applyCommittedSheetLabels(projectId, character.id, payload.sheet.id);
      onLibrarySync?.(synced);
      setStatus("The complete contact-sheet version already existed, so its labels were reapplied.");
      notify?.("FPAI v1.2 contact-sheet references synchronized.");
    } catch (err) {
      setError(err.message);
      setStatus("Contact-sheet separation stopped. Every committed reference and source sheet remains unchanged.");
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
            <div className="sheetHeadActions">
              <button type="button" className="ghost compact" disabled={busy} onClick={() => input.current?.click()}>Upload new version</button>
              {!removeConfirm ? (
                <button type="button" className="ghost compact danger" disabled={busy} onClick={() => setRemoveConfirm(true)}><Trash2 /> Remove old sheet</button>
              ) : (
                <span className="sheetRemoveConfirm">
                  <b>Remove this old sheet?</b>
                  <button type="button" className="ghost compact" disabled={busy} onClick={() => setRemoveConfirm(false)}>Cancel</button>
                  <button type="button" className="danger compact" disabled={busy} onClick={removeOldSheet}>Remove</button>
                </span>
              )}
            </div>
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
              <button type="button" className="ghost compact" disabled={busy} onClick={applyContactSheetLayout}><Grid3X3 /> FPAI v1.2 · 26 photos</button>
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
              const separation = characterSheetSeparationPlan(sheet, cell);
              const lowResolution = isLowResolutionReferenceCrop(sheet, cell);
              const unseparable = isUnseparableReferenceCrop(sheet, cell);
              return (
              <div className={`${cell.included ? "sheetCell" : "sheetCell excluded"}${lowResolution ? " lowResolution" : ""}${unseparable ? " unseparable" : ""}`} key={cell.id}>
                <span className="sheetCellThumb" style={cropPreviewStyle(previewUrl, cell)} aria-hidden="true" />
                <span className="sheetCellTitle">
                  <b>Panel {cell.id.replace("cell-", "")}{cell.variant ? ` · ${cell.variant.replace(/^\d+-/, "").replaceAll("-", " ")}` : ""}</b>
                  {size.width > 0 && <small>{size.width}×{size.height}{unseparable ? " · too small" : separation.needsSeparation ? ` → ${separation.output.width}×${separation.output.height}` : ""}</small>}
                </span>
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
          {!committed && !customMode && cells.length < MAX_CHARACTER_SHEET_PANELS && (
            <button type="button" className="ghost compact addCrop" disabled={busy} onClick={addCustomCrop}><Crop /> Add a custom crop</button>
          )}
          {!committed && cells.some((cell) => cell.included && characterSheetSeparationPlan(sheet, cell).needsSeparation && !isUnseparableReferenceCrop(sheet, cell)) && (
            <p className="sheetSeparationNote">Small contact-sheet panels will be separated into individual high-resolution files in your browser. The original Character Bible remains unchanged, and no paid model is called.</p>
          )}
          {committed ? (
            <>
              <p className="sheetCommitted"><CheckCircle2 /> Version {sheet.version} is committed with {sheet.manifest?.panels?.length || 0} usable references.</p>
              {sheet.status === "committed" && <>
                <button type="button" className="ghost" disabled={busy} onClick={applyLabels}>Apply committed labels</button>
                <p className="sub">Use this to repair an earlier import or explicitly reselect this sheet’s required slots and matching expression images. Other images are preserved.</p>
                {contactSheetCompatible ? <>
                  <button type="button" className="primary full sheetRepair" disabled={busy} onClick={reprocessContactSheet}><Grid3X3 /> Re-separate 26 Contact Sheet Photos</button>
                  <p className="sub">Creates a reviewable high-resolution separation version from the stored FPAI v1.2 source. No paid provider is called.</p>
                </> : <>
                  <button type="button" className="primary full sheetRepair" disabled={busy || !fpaiSourceCompatible} onClick={reprocessExpressionBank}><Grid3X3 /> Extract 6 Expression Panels</button>
                  <p className="sub">{fpaiSourceCompatible ? "For the single-page 5:6 FPAI Bible only. Creates a reviewable version and does not generate images, call a paid provider, or change the committed version." : "Unavailable for this source layout. Use custom crops or full-resolution individual expression portraits; no existing references are changed."}</p>
                </>}
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
