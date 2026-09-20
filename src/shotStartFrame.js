export const START_FRAME_TYPES = Object.freeze(["image/png", "image/jpeg"]);
export const START_FRAME_SOURCE_LIMIT = 20 * 1024 * 1024;
export const START_FRAME_PROVIDER_LIMIT = 2 * 1024 * 1024;

export function isLtxProviderId(provider) {
  return String(provider || "").startsWith("ltx-2.5-");
}

export function validateShotStartFrame(file) {
  if (!file || !START_FRAME_TYPES.includes(file.type)) {
    throw new Error("Shot Start Frame must be a PNG or JPEG image.");
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error("Shot Start Frame is empty.");
  }
  if (file.size > START_FRAME_SOURCE_LIMIT) {
    throw new Error("Shot Start Frame must be 20 MB or smaller.");
  }
  return {
    name: file.name || "shot-start-frame",
    mimeType: file.type,
    size: file.size,
  };
}

export function renderReferenceKeys({ provider, startFrameKey, selected = [] }) {
  if (isLtxProviderId(provider) && startFrameKey) return [startFrameKey];
  return [...selected];
}
