export const MOTION_VIDEO_MAX_BYTES = 32 * 1024 * 1024;
export function inspectMotionVideo(bytes, mimeType = "video/mp4") {
  if (mimeType !== "video/mp4" || bytes.length < 32 || bytes.length > MOTION_VIDEO_MAX_BYTES)
    throw new Error("Choose an MP4 under 32 MB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start) => String.fromCharCode(...bytes.subarray(start, start + 4));
  let duration, hasFtyp = false;
  function boxes(start, end, depth = 0) {
    if (depth > 2) throw new Error("Invalid MP4 structure.");
    for (let at = start; at < end;) {
      if (at + 8 > end) throw new Error("Truncated MP4.");
      let size = view.getUint32(at), header = 8;
      const type = text(at + 4);
      if (size === 1) {
        if (at + 16 > end) throw new Error("Truncated MP4.");
        size = Number(view.getBigUint64(at + 8)); header = 16;
      } else if (size === 0) size = end - at;
      if (!Number.isSafeInteger(size) || size < header || at + size > end) throw new Error("Invalid MP4 box.");
      const payload = at + header;
      if (type === "ftyp" && depth === 0) hasFtyp = true;
      if (type === "moov" && depth === 0) boxes(payload, at + size, depth + 1);
      if (type === "mvhd" && depth === 1) {
        const version = bytes[payload];
        if (![0, 1].includes(version) || payload + (version ? 32 : 20) > at + size) throw new Error("Invalid MP4 duration.");
        const scale = view.getUint32(payload + (version ? 20 : 12));
        const ticks = version ? Number(view.getBigUint64(payload + 24)) : view.getUint32(payload + 16);
        duration = ticks / scale;
      }
      at += size;
    }
  }
  boxes(0, bytes.length);
  if (!hasFtyp || !Number.isFinite(duration) || duration < 4 || duration > 30)
    throw new Error("Choose a complete MP4 lasting 4–30 seconds.");
  return { duration, billedSeconds: Math.ceil(duration) };
}
