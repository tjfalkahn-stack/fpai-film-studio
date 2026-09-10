/**
 * Seedance 2.0 fal.ai rate card.
 *
 * Defaults are published-price assumptions, not permanent business logic.
 * Override via provider env without changing router selection code.
 */
export const SEEDANCE_PRICING_UPDATED_AT = "2026-09-10";
export const SEEDANCE_PRICE_BASIS = "fal-seedance-2.0-assumption-2026-09-10";

export const DEFAULT_SEEDANCE_RATES = Object.freeze({
  "fast-720p": 0.2419,
  "standard-720p": 0.3024,
  "standard-1080p": 0.682,
});

export const SEEDANCE_RATE_ENV_KEYS = Object.freeze({
  "fast-720p": "SEEDANCE_FAST_720P_PER_SECOND_USD",
  "standard-720p": "SEEDANCE_STANDARD_720P_PER_SECOND_USD",
  "standard-1080p": "SEEDANCE_STANDARD_1080P_PER_SECOND_USD",
  "standard-720p-reference-video": "SEEDANCE_STANDARD_REFERENCE_VIDEO_720P_PER_SECOND_USD",
  "standard-1080p-reference-video": "SEEDANCE_STANDARD_REFERENCE_VIDEO_1080P_PER_SECOND_USD",
});

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;

function readRate(env, key, fallback) {
  if (!env || env[key] == null || env[key] === "") return fallback;
  const numeric = Number(env[key]);
  if (!Number.isFinite(numeric) || numeric < 0) {
    const error = new Error(`${key} must be a non-negative number.`);
    error.code = "PROVIDER_CONFIG";
    error.httpStatus = 503;
    throw error;
  }
  return numeric;
}

export function seedanceRateKey(tier, resolution, { hasReferenceVideo = false } = {}) {
  const base = `${tier}-${resolution}`;
  return hasReferenceVideo ? `${base}-reference-video` : base;
}

export function seedanceRatePerSecond(tier, resolution, env = {}, options = {}) {
  const hasReferenceVideo = Boolean(options.hasReferenceVideo);
  const envKey = SEEDANCE_RATE_ENV_KEYS[seedanceRateKey(tier, resolution, { hasReferenceVideo })];
  if (hasReferenceVideo && envKey) {
    const override = env[envKey];
    if (override != null && override !== "") return readRate(env, envKey, null);
  }
  const baseKey = `${tier}-${resolution}`;
  const fallback = DEFAULT_SEEDANCE_RATES[baseKey];
  if (fallback == null) {
    const error = new Error(`No Seedance rate configured for ${tier} ${resolution}.`);
    error.code = "UNSUPPORTED_INPUT";
    error.httpStatus = 400;
    throw error;
  }
  const baseEnvKey = SEEDANCE_RATE_ENV_KEYS[baseKey];
  return baseEnvKey ? readRate(env, baseEnvKey, fallback) : fallback;
}

export function estimateSeedanceCost(input = {}, env = {}) {
  const tier = input.tier || (input.provider === "seedance-standard" ? "standard" : "fast");
  const resolution = input.resolution || "720p";
  const duration = Number(input.duration);
  const hasReferenceVideo = Boolean(
    optionsHasReferenceVideo(input) || optionsHasReferenceVideo(input.referenceVideos),
  );
  const ratePerSecond = seedanceRatePerSecond(tier, resolution, env, { hasReferenceVideo });
  const estimatedCost = money(duration * ratePerSecond);
  return {
    estimatedCost,
    currency: "USD",
    priceBasis: env.SEEDANCE_PRICE_BASIS || SEEDANCE_PRICE_BASIS,
    ratePerSecond,
    duration,
    resolution,
    tier,
    hasReferenceVideo,
  };
}

function optionsHasReferenceVideo(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Boolean(value.url || value.data);
  return Boolean(value);
}

export { money as roundSeedanceMoney };
