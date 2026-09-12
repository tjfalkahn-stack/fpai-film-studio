import { libraryBase } from "./characterReferenceClient.js";

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

export async function ingestCharacterSheet(projectId, characterId, file, cells) {
  const form = new FormData();
  form.set("file", file);
  form.set("cells", JSON.stringify(cells));
  return readJson(await fetch(base(projectId, characterId), { method: "POST", body: form }));
}

export async function updateCharacterSheet(projectId, characterId, sheetId, cells) {
  return readJson(await fetch(`${base(projectId, characterId)}/${sheetId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cells }),
  }));
}

export async function commitCharacterSheet(projectId, characterId, sheetId, cells) {
  return readJson(await fetch(`${base(projectId, characterId)}/${sheetId}/commit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cells }),
  }));
}

