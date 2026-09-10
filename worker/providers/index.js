import { createMockProvider } from "./mock.js";
import { createVeoProvider } from "./veo.js";
import { createComfyProvider } from "./comfy.js";
import {
  createSeedanceFastProvider,
  createSeedanceStandardProvider,
} from "./seedance.js";
import { fail } from "./contract.js";

export function providers(env) {
  return [
    createMockProvider(),
    createComfyProvider(env),
    createSeedanceFastProvider(env),
    createSeedanceStandardProvider(env),
    createVeoProvider(env),
  ];
}
export function providerFor(id, env) {
  return (
    providers(env).find((provider) => provider.capabilities.id === id) ||
    fail("UNKNOWN_PROVIDER", "Unknown renderer.")
  );
}
