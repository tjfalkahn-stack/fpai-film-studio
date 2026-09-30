/**
 * Renderer contract (server only):
 * capabilities: {id, model, durations, resolutions, aspectRatios, maxReferences, cancelRunning}
 * estimate(input) -> {estimatedCost, currency, priceBasis}
 * start(input) -> {operationId}
 * status(job) -> {status, actualCost?, costBasis?, asset?, error?}
 * cancel(job) -> {status, actualCost?, costBasis?} (must explicitly reject unsupported cancellation)
 * asset(job) -> Response containing video bytes (never a credential-bearing URL).
 * ProviderError: code, message, retryable, uncertain, httpStatus.
 * Unknown submission outcomes retain reservations and MUST NOT auto-resubmit.
 */
export class ProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    Object.assign(
      this,
      { code, httpStatus: 400, retryable: false, uncertain: false },
      options,
    );
  }
}

export const fail = (code, message, httpStatus = 400) => {
  throw new ProviderError(code, message, { httpStatus });
};

export function validateInput(input, capabilities) {
  for (const key of ["projectId", "sceneId", "shotId"]) {
    if (
      typeof input[key] !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(input[key])
    )
      fail("INVALID_INPUT", `Invalid ${key}.`);
  }
  if (
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    input.prompt.length > 12000
  )
    fail("INVALID_INPUT", "Prompt must contain 1–12,000 characters.");
  if (input.sourceAudio && !capabilities.audioInput)
    fail("UNSUPPORTED_INPUT", "This model does not accept uploaded audio.");
  for (const [key, allowed] of [
    ["duration", input.sourceAudio && capabilities.audioInput ? null : capabilities.durations],
    ["resolution", capabilities.resolutions],
    ["aspectRatio", capabilities.aspectRatios],
  ]) {
    if (key === "duration" && allowed === null) {
      const max = capabilities.tier === "fast" ? 20 : 10;
      if (!Number.isFinite(input.duration) || input.duration < 1 || input.duration > max ||
          Math.abs(input.duration - input.sourceAudio.duration) > 0.02)
        fail("UNSUPPORTED_INPUT", `Audio duration must match the clip and be 1–${max} seconds.`);
      continue;
    }
    if (!allowed.includes(input[key]))
      fail(
        "UNSUPPORTED_INPUT",
        `Unsupported ${key}. Allowed: ${allowed.join(", ")}.`,
      );
  }
  const refs = Array.isArray(input.referenceImages) ? input.referenceImages : [];
  input.referenceImages = refs;
  if (input.sourceAudio) {
    const audio = input.sourceAudio;
    if (!["audio/mpeg", "audio/mp4", "audio/ogg"].includes(audio.mimeType) ||
        typeof audio.data !== "string" || audio.data.length > 4200000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(audio.data) ||
        !Number.isFinite(audio.duration))
      fail("INVALID_AUDIO", "Upload a valid MP3, M4A, or OGG clip under 3 MB.");
    const bytes = Uint8Array.from(atob(audio.data), (c) => c.charCodeAt(0));
    const mp3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 ||
      bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    const m4a = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    const ogg = bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
    if (bytes.byteLength > 3 * 1024 * 1024 || !(audio.mimeType === "audio/mpeg" ? mp3 : audio.mimeType === "audio/mp4" ? m4a : ogg))
      fail("INVALID_AUDIO", "Audio bytes do not match the selected format or exceed 3 MB.");
  }
  if (refs.length > capabilities.maxReferences)
    fail(
      "INVALID_REFERENCES",
      `Choose at most ${capabilities.maxReferences} reference images.`,
    );
  for (const ref of [...refs, ...(input.endFrameImage ? [input.endFrameImage] : [])]) {
    if (!ref || typeof ref !== "object")
      fail("INVALID_REFERENCES", "A frame must be a PNG or JPEG image.");
    const libraryRef =
      typeof ref.assetId === "string" &&
      /^[a-f0-9-]{36}$/i.test(ref.assetId) &&
      typeof ref.characterId === "string";
    if (libraryRef && ref.data == null) {
      if (capabilities.id !== "mock" && !["image/png", "image/jpeg"].includes(ref.mimeType)) {
        fail(
          "INVALID_REFERENCES",
          "Live providers currently accept PNG or JPEG character references only.",
        );
      }
      continue;
    }
    if (
      !["image/png", "image/jpeg"].includes(ref.mimeType) ||
      typeof ref.data !== "string" ||
      ref.data.length > 2800000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(ref.data)
    )
      fail(
        "INVALID_REFERENCES",
        "References must be inline PNG/JPEG images, at most 2 MB each.",
      );
    const bytes = Uint8Array.from(atob(ref.data), (c) => c.charCodeAt(0));
    const png =
      bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!(ref.mimeType === "image/png" ? png : jpeg))
      fail(
        "INVALID_REFERENCES",
        "Reference bytes do not match their image type.",
      );
  }
  if (
    capabilities.forceEightSecondSource === true &&
    (refs.length || input.resolution !== "720p") &&
    input.duration !== 8
  )
    fail(
      "UNSUPPORTED_INPUT",
      "Reference images and 1080p require an 8-second source clip.",
    );
  return input;
}
