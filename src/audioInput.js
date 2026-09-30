export const AUDIO_LIMIT = 3 * 1024 * 1024;

export async function encodeSourceAudio(file) {
  if (!file) return null;
  const mimeType = file.type === "audio/x-m4a" ? "audio/mp4" : file.type;
  if (!["audio/mpeg", "audio/mp4", "audio/ogg"].includes(mimeType))
    throw new Error("Choose an MP3, M4A, or OGG audio clip.");
  if (file.size > AUDIO_LIMIT) throw new Error("Audio must be under 3 MB. Export a short performance clip.");
  const url = URL.createObjectURL(file);
  let duration;
  try {
    duration = await new Promise((resolve, reject) => {
      const media = new Audio();
      media.preload = "metadata";
      media.onloadedmetadata = () => resolve(media.duration);
      media.onerror = () => reject(new Error("Could not read the audio duration."));
      media.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
  if (!Number.isFinite(duration) || duration < 1 || duration > 20)
    throw new Error("Choose a 1–20 second audio clip. LTX Pro accepts up to 10 seconds.");
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read the audio file."));
    reader.readAsDataURL(file);
  });
  return { mimeType, data, duration: Number(duration.toFixed(3)) };
}
