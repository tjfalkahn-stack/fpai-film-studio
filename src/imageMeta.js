/** Parse PNG, JPEG, and WebP headers. Does not decode pixel data. */

export const ALLOWED_REFERENCE_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
export const MIN_UPLOAD_DIMENSION = 64;
export const MAX_UPLOAD_DIMENSION = 8192;
export const SUFFICIENT_RESOLUTION = 512;

function bytesOf(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new Error("Image bytes are required.");
}

function view(bytes, offset, length) {
  return bytes.subarray(offset, offset + length);
}

function u16be(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u16le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32be(bytes, offset) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function u24le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function sniffImageMime(bytes) {
  const data = bytesOf(bytes);
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.length >= 12 &&
    ascii(data, 0, 4) === "RIFF" &&
    ascii(data, 8, 4) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function pngSize(bytes) {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function jpegSize(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16be(bytes, offset + 2);
    if (length < 2) return null;
    const sof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (sof) {
      return { height: u16be(bytes, offset + 5), width: u16be(bytes, offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(bytes) {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: u24le(bytes, 24) + 1,
      height: u24le(bytes, 27) + 1,
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    const start = 20;
    if (bytes[start] !== 0x9d || bytes[start + 1] !== 0x01 || bytes[start + 2] !== 0x2a) return null;
    return {
      width: u16le(bytes, start + 3) & 0x3fff,
      height: u16le(bytes, start + 5) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25) {
    const signature = bytes[20];
    if (signature !== 0x2f) return null;
    const bits =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

export function readImageSize(bytes, mimeType) {
  const data = bytesOf(bytes);
  const sniffed = sniffImageMime(data);
  const mime = normalizeMimeType(mimeType || sniffed);
  if (!mime || (sniffed && mime !== sniffed && !(mime === "image/jpeg" && sniffed === "image/jpeg"))) {
    if (sniffed && mime && mime !== sniffed) return null;
  }
  if ((mime || sniffed) === "image/png") return pngSize(data);
  if ((mime || sniffed) === "image/jpeg") return jpegSize(data);
  if ((mime || sniffed) === "image/webp") return webpSize(data);
  return null;
}

export function normalizeMimeType(value) {
  const mime = String(value || "").trim().toLowerCase();
  if (mime === "image/jpg") return "image/jpeg";
  if (ALLOWED_REFERENCE_MIME_TYPES.includes(mime)) {
    return mime === "image/jpg" ? "image/jpeg" : mime;
  }
  return null;
}

export function extensionForMime(mimeType) {
  const mime = normalizeMimeType(mimeType);
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg") return "jpg";
  return "bin";
}

export function validateReferenceFile({ bytes, mimeType, filename, byteSize }) {
  const errors = [];
  const data = bytesOf(bytes);
  const size = Number.isFinite(byteSize) ? byteSize : data.byteLength;
  if (size <= 0) errors.push("File is empty.");
  if (size > MAX_REFERENCE_BYTES) {
    errors.push(`File exceeds the ${Math.round(MAX_REFERENCE_BYTES / (1024 * 1024))} MB upload limit.`);
  }
  const declared = normalizeMimeType(mimeType);
  const sniffed = sniffImageMime(data);
  if (!declared) errors.push("Only JPG, PNG, and WebP images are accepted.");
  if (!sniffed) errors.push("File is not a recognizable JPG, PNG, or WebP image.");
  if (declared && sniffed && declared !== sniffed) {
    errors.push("Declared image type does not match the file contents.");
  }
  const mime = sniffed || declared;
  const dimensions = mime ? readImageSize(data, mime) : null;
  if (!dimensions?.width || !dimensions?.height) {
    errors.push("Image dimensions could not be read from the file header.");
  } else {
    if (dimensions.width < MIN_UPLOAD_DIMENSION || dimensions.height < MIN_UPLOAD_DIMENSION) {
      errors.push(`Images must be at least ${MIN_UPLOAD_DIMENSION}×${MIN_UPLOAD_DIMENSION} pixels.`);
    }
    if (dimensions.width > MAX_UPLOAD_DIMENSION || dimensions.height > MAX_UPLOAD_DIMENSION) {
      errors.push(`Images may not exceed ${MAX_UPLOAD_DIMENSION}×${MAX_UPLOAD_DIMENSION} pixels.`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    mimeType: mime || declared,
    filename: String(filename || "reference").slice(0, 200),
    byteSize: size,
    width: dimensions?.width || 0,
    height: dimensions?.height || 0,
    sufficientResolution: Boolean(
      dimensions && Math.min(dimensions.width, dimensions.height) >= SUFFICIENT_RESOLUTION,
    ),
  };
}

export function isProviderInlineMime(mimeType) {
  const mime = normalizeMimeType(mimeType);
  return mime === "image/png" || mime === "image/jpeg";
}