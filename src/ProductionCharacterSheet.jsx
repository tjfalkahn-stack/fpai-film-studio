import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Grid3X3, Upload } from "lucide-react";
import {
  CHARACTER_SHEET_LABELS,
  defaultCharacterSheetCells,
  referenceFieldsForSheetCell,
} from "./characterSheets.js";
import {
  commitCharacterSheet,
  fetchCharacterSheets,
  ingestCharacterSheet,
  updateCharacterSheet,
} from "./characterSheetClient.js";
import { uploadCharacterReference } from "./characterReferenceClient.js";

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

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

export default function ProductionCharacterSheet({ projectId, character, onLibrarySync, notify }) {
  const input = useRef(null);
  const [sheets, setSheets] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [sourceFile, setSourceFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cells = sheet?.cells || [];
  const previewUrl = useMemo(() => sourceFile ? URL.createObjectURL(sourceFile) : sheet?.assetUrl || "", [sourceFile, sheet?.assetUrl]);
  useEffect(() => () => { if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    let canceled = false;
    fetchCharacterSheets(projectId, character.id).then((payload) => {
      if (canceled) return;
      setSheets(payload.sheets || []);
      setSheet((payload.sheets || []).find((item) => item.status === "draft") || (payload.sheets || [])[0] || null);
    }).catch(() => {});
    return () => { canceled = true; };
  }, [projectId, character.id]);

  async function ingest(file) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const payload = await ingestCharacterSheet(projectId, character.id, file, defaultCharacterSheetCells());
      setSourceFile(file);
      setSheet(payload.sheet);
      setSheets(payload.sheets || [payload.sheet]);
      notify?.("Character sheet uploaded. Review the panel labels before committing it.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function changeCell(id, patch) {
    setSheet((current) => ({ ...current, cells: current.cells.map((cell) => cell.id === id ? { ...cell, ...patch, assetId: null } : cell) }));
  }

  function applyGrid(columns, rows) {
    setSheet((current) => ({ ...current, cells: defaultCharacterSheetCells(columns, rows) }));
  }

  async function saveReview() {
    setBusy(true);
    setError("");
    try {
      const payload = await updateCharacterSheet(projectId, character.id, sheet.id, cells);
      setSheet(payload.sheet);
      notify?.("Character sheet review saved.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true);
    setError("");
    try {
      const source = sourceFile || await fetch(sheet.assetUrl).then((response) => {
        if (!response.ok) throw new Error("The stored character sheet could not be loaded.");
        return response.blob();
      });
      const committedCells = [];
      for (const cell of cells) {
        if (!cell.included) { committedCells.push({ ...cell, assetId: null }); continue; }
        const fields = referenceFieldsForSheetCell(cell, character.wardrobe);
        const crop = await cropPanel(source, cell, sheet.filename);
        let payload;
        try {
          payload = await uploadCharacterReference(projectId, character.id, crop, fields);
        } catch (err) {
          if (err.status !== 409 || !err.payload?.reference?.id) throw err;
          payload = { reference: err.payload.reference };
        }
        committedCells.push({ ...cell, assetId: payload.reference.id });
        onLibrarySync?.(payload);
      }
      const payload = await commitCharacterSheet(projectId, character.id, sheet.id, committedCells);
      setSheet(payload.sheet);
      setSheets((current) => [payload.sheet, ...current.filter((item) => item.id !== payload.sheet.id)]);
      onLibrarySync?.(payload);
      notify?.(`Production Character Sheet v${payload.sheet.version} committed. Rebuild the Character Lock when ready.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const committed = sheet?.status === "committed" || sheet?.status === "archived";
  return (
    <section className="productionSheet">
      <div className="sectionTitle"><Grid3X3 /><span>PRODUCTION CHARACTER SHEET</span></div>
      <p className="dropHint">Upload one character sheet, confirm what each panel shows, then commit it. The studio creates the usable references for you.</p>
      {!sheet && (
        <button type="button" className="sheetUpload" disabled={busy} onClick={() => input.current?.click()}>
          <Upload /><b>Upload one character sheet</b><small>JPG, PNG, or WebP · a 3×3 sheet works best</small>
        </button>
      )}
      <input ref={input} className="hiddenInput" type="file" accept={ACCEPT} onChange={(event) => { ingest(event.target.files?.[0]); event.target.value = ""; }} />
      {sheet && (
        <>
          <div className="sheetHead">
            <div><b>{sheet.filename}</b><small>Version {sheet.version} · {sheet.status}</small></div>
            <button type="button" className="ghost compact" disabled={busy} onClick={() => input.current?.click()}>Upload new version</button>
          </div>
          <div className="sheetPreview">
            <img src={previewUrl} alt={`${character.name} production character sheet`} />
            {cells.map((cell) => <i key={cell.id} className={cell.included ? "" : "excluded"} style={{ left: `${cell.x * 100}%`, top: `${cell.y * 100}%`, width: `${cell.width * 100}%`, height: `${cell.height * 100}%` }}><span>{cell.id.replace("cell-", "")}</span></i>)}
          </div>
          {!committed && (
            <div className="sheetTemplates">
              <span>Sheet layout</span>
              <button type="button" className="ghost compact" disabled={busy} onClick={() => applyGrid(2, 3)}>2×3</button>
              <button type="button" className="ghost compact" disabled={busy} onClick={() => applyGrid(3, 3)}>3×3</button>
              <button type="button" className="ghost compact" disabled={busy} onClick={() => applyGrid(4, 3)}>4×3</button>
            </div>
          )}
          <div className="sheetCells">
            {cells.map((cell) => (
              <div className={cell.included ? "sheetCell" : "sheetCell excluded"} key={cell.id}>
                <b>Panel {cell.id.replace("cell-", "")}</b>
                <select disabled={busy || committed} value={cell.label} onChange={(event) => changeCell(cell.id, { label: event.target.value, included: event.target.value !== "exclude" })}>
                  {CHARACTER_SHEET_LABELS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
                <label><input type="checkbox" disabled={busy || committed} checked={cell.included} onChange={(event) => changeCell(cell.id, { included: event.target.checked })} /> Use</label>
              </div>
            ))}
          </div>
          {committed ? (
            <p className="sheetCommitted"><CheckCircle2 /> Version {sheet.version} is committed with {sheet.manifest?.panels?.length || 0} usable references.</p>
          ) : (
            <div className="buttonRow">
              <button type="button" className="ghost" disabled={busy} onClick={saveReview}>Save corrections</button>
              <button type="button" className="primary" disabled={busy || !cells.some((cell) => cell.included)} onClick={commit}>Commit Character Sheet</button>
            </div>
          )}
          {sheets.length > 1 && <p className="sub">{sheets.length} sheet versions preserved. Older committed versions remain available in their manifests.</p>}
        </>
      )}
      {error && <div className="validation">{error}</div>}
    </section>
  );
}
