import { libraryBase } from "./characterReferenceClient.js";
import { MAX_CHARACTER_SHEET_COMMIT_BYTES } from "./characterSheets.js";

async function readJson(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error?.message || result.error || `Character sheet HTTP ${response.status}`);
    error.status = response.status;
    error.code = result.error?.code;
    throw error;
  }
  return result;
}

const base = (projectId, characterId) => `${libraryBase(projectId, characterId)}/character-sheets`;

export async function fetchCharacterSheets(projectId, characterId) {
  return readJson(await fetch(base(projectId, characterId)));
}

export function ingestCharacterSheet(projectId, characterId, file, cells, { onProgress } = {}) {
  const form = new FormData();
  form.set("file", file);
  form.set("cells", JSON.stringify(cells));
  return uploadSheetForm(base(projectId, characterId), form, onProgress);
}

function uploadSheetForm(url, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const result = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(result);
        return;
      }
      const error = new Error(result.error?.message || result.error || `Character sheet upload failed (${xhr.status})`);
      error.status = xhr.status;
      error.code = result.error?.code;
      error.payload = result;
      reject(error);
    };
    xhr.onerror = () => reject(new Error("Network error while uploading the character sheet."));
    xhr.send(form);
  });
}

export async function updateCharacterSheet(projectId, characterId, sheetId, cells) {
  return readJson(await fetch(`${base(projectId, characterId)}/${sheetId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cells }),
  }));
}

export async function commitCharacterSheet(projectId, characterId, sheetId, cells, { crops, wardrobe = "", onProgress } = {}) {
  if (crops) {
    if (crops.reduce((sum, crop) => sum + crop.file.size, 0) > MAX_CHARACTER_SHEET_COMMIT_BYTES) {
      throw new Error("Prepared crops exceed the 24 MB commit limit. Use smaller crops or fewer panels.");
    }
    const form = new FormData();
    form.set("cells", JSON.stringify(cells));
    form.set("wardrobe", wardrobe);
    for (const crop of crops) form.set(`panel:${crop.id}`, crop.file);
    return uploadSheetForm(`${base(projectId, characterId)}/${sheetId}/commit`, form, onProgress);
  }
  return readJson(await fetch(`${base(projectId, characterId)}/${sheetId}/commit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cells }),
  }));
}

export async function applyCommittedSheetLabels(projectId, characterId, sheetId) {
  return readJson(await fetch(`${base(projectId, characterId)}/${sheetId}/apply-labels`, { method: "POST" }));
}
