export function libraryBase(projectId, characterId) {
  return `/api/projects/${projectId}/characters/${characterId}`;
}

async function readJson(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      result.error?.message || result.error || `Character library HTTP ${response.status}`,
    );
    error.status = response.status;
    error.code = result.error?.code;
    error.payload = result;
    throw error;
  }
  return result;
}

export async function fetchCharacterLibrary(projectId, characterId) {
  return readJson(await fetch(`${libraryBase(projectId, characterId)}/references`));
}

export async function fetchCharacterLock(projectId, characterId) {
  return readJson(await fetch(`${libraryBase(projectId, characterId)}/lock`));
}

export function uploadCharacterReference(projectId, characterId, file, fields = {}, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${libraryBase(projectId, characterId)}/references`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const result = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(result);
      else {
        const error = new Error(result.error?.message || `Upload failed (${xhr.status})`);
        error.status = xhr.status;
        error.code = result.error?.code;
        error.payload = result;
        reject(error);
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading the reference image."));
    const form = new FormData();
    form.set("file", file);
    for (const [key, value] of Object.entries(fields)) {
      if (value == null || value === "") continue;
      form.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    xhr.send(form);
  });
}

export async function patchCharacterReference(projectId, characterId, assetId, patch) {
  return readJson(
    await fetch(`${libraryBase(projectId, characterId)}/references/${assetId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

export async function patchCharacterLibrary(projectId, characterId, body) {
  return readJson(
    await fetch(`${libraryBase(projectId, characterId)}/references`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function deleteCharacterReference(projectId, characterId, assetId) {
  return readJson(
    await fetch(`${libraryBase(projectId, characterId)}/references/${assetId}`, {
      method: "DELETE",
    }),
  );
}

export async function rebuildCharacterLock(projectId, characterId) {
  return readJson(
    await fetch(`${libraryBase(projectId, characterId)}/lock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
}
