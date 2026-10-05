export const REFERENCE_VIDEO_MAX_BYTES = 32 * 1024 * 1024;

export function matchProviderDuration(seconds, allowed = []) {
  const values = Array.isArray(allowed) && allowed.length ? allowed : [Math.max(1, Math.ceil(Number(seconds) || 1))];
  const rounded = Math.max(1, Math.ceil(Number(seconds) || 1));
  if (values.includes(rounded)) return rounded;
  const next = values.find((value) => value >= rounded);
  return next ?? values[values.length - 1];
}

export async function readVideoDuration(file, createObjectURL = URL.createObjectURL, revokeObjectURL = URL.revokeObjectURL) {
  const url = createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(video.duration);
      video.onerror = () => reject(new Error("Could not read the MP4 duration."));
      video.src = url;
    });
  } finally {
    revokeObjectURL(url);
  }
}

export async function uploadReferenceVideo(file, { duration } = {}) {
  if (!file) throw new Error("Choose an MP4 reference video.");
  const mime = String(file.type || "").split(";")[0].trim().toLowerCase();
  if (mime !== "video/mp4") throw new Error("Upload an MP4 reference video.");
  if (file.size > REFERENCE_VIDEO_MAX_BYTES) throw new Error("Reference videos must be 32 MB or smaller.");
  const form = new FormData();
  form.set("file", file);
  if (duration != null && duration !== "") form.set("duration", String(duration));
  const response = await fetch("/api/reference-videos", { method: "POST", body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error?.message || result.error || `Reference video HTTP ${response.status}`);
    error.status = response.status;
    error.payload = result;
    throw error;
  }
  return result;
}
