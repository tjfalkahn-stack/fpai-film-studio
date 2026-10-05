export const REFERENCE_VIDEO_MAX_BYTES = 32 * 1024 * 1024;
export const REFERENCE_VIDEO_MAX_SECONDS = 30;

export function matchProviderDuration(seconds, allowed = []) {
  const raw = Number(seconds);
  if (!Number.isFinite(raw) || raw < 1) {
    throw new Error("Reference videos must be at least 1 second.");
  }
  if (raw > REFERENCE_VIDEO_MAX_SECONDS) {
    throw new Error("Reference videos must be 30 seconds or shorter. Trim the clip before uploading.");
  }
  const values = (Array.isArray(allowed) ? allowed : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= REFERENCE_VIDEO_MAX_SECONDS);
  const rounded = Math.ceil(raw);
  if (!values.length) return rounded;
  const maxAllowed = Math.max(...values);
  if (raw > maxAllowed) {
    throw new Error(`This model accepts clips up to ${maxAllowed} seconds. Trim the clip before uploading.`);
  }
  if (values.includes(rounded)) return rounded;
  const next = values.find((value) => value >= rounded);
  if (next == null) {
    throw new Error(`This model accepts clips up to ${maxAllowed} seconds. Trim the clip before uploading.`);
  }
  return next;
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
  if (duration != null && duration !== "") {
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > REFERENCE_VIDEO_MAX_SECONDS) {
      throw new Error("Reference videos must be 30 seconds or shorter. Trim the clip before uploading.");
    }
  }
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
