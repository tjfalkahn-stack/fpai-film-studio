import { createMockProvider } from "./mock.js";
import { createVeoProvider } from "./veo.js";
import { createComfyProvider } from "./comfy.js";
import {
  createSeedanceFastProvider,
  createSeedanceStandardProvider,
} from "./seedance.js";
import { createVibesManualProvider } from "./vibes.js";
import { createDrawThingsLocalProvider } from "./drawThings.js";
import { createLtxFastProvider, createLtxProProvider } from "./ltx.js";
import { fail } from "./contract.js";

export function providers(env) {
  return [
    createMockProvider(),
    createDrawThingsLocalProvider(),
    createVibesManualProvider(),
    createComfyProvider(env),
    createSeedanceFastProvider(env),
    createSeedanceStandardProvider(env),
    createLtxFastProvider(env),
    createLtxProProvider(env),
    createVeoProvider(env),
  ];
}
export function providerFor(id, env) {
  return (
    providers(env).find((provider) => provider.capabilities.id === id) ||
    fail("UNKNOWN_PROVIDER", "Unknown renderer.")
  );
}
