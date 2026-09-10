import fs from "node:fs/promises";
import path from "node:path";
import { createCharacterFactorySmokePlan } from "../src/characterFactory.js";
import { CHARACTER_STILL_STACK_ID, CHARACTER_STILL_STACK_LABEL } from "../src/characterStillStack.js";

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const characterFile = getArg("--character", "benchmarks/jasmine.character.json");
const outDir = getArg("--out", "benchmarks/output");
const raw = JSON.parse(await fs.readFile(characterFile, "utf8"));
const plan = createCharacterFactorySmokePlan({ ...raw, medium: raw.medium || "cinematic" });

await fs.mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `${plan.character.id}.first-test.plan.json`);
const packet = {
  schema: "fpai.character-factory.first-test.v1",
  execute: false,
  maxImages: 1,
  stackId: CHARACTER_STILL_STACK_ID,
  stackLabel: CHARACTER_STILL_STACK_LABEL,
  liveFlagsRequired: {
    CHARACTER_FACTORY_LIVE_ENABLED: "true",
    LIVE_RENDERING_ENABLED: "false",
  },
  liveFlagsInThisRepo: {
    CHARACTER_FACTORY_LIVE_ENABLED: "false",
    LIVE_RENDERING_ENABLED: "false",
  },
  objective: [
    "Comfy connectivity",
    "Character Bible reference upload via POST /upload/image",
    "FPAI identity workflow submission via POST /prompt",
    "Identity conditioning from multiple references",
    "Output retrieval via GET /view",
    "QC evaluation",
    "manifest.json + character.json",
    "budget accounting in the factory ledger",
  ],
  blockedUntil: [
    "RunPod ComfyUI Pod is started",
    "deploy/runpod-comfyui/bootstrap.sh has completed",
    "GET /api/character-factory/preflight returns ready=true",
    "Jasmine Character Bible images exist (identity/front, and supporting angles if available)",
    "Owner explicitly sets CHARACTER_FACTORY_LIVE_ENABLED=true for this one image only",
  ],
  plan,
};

await fs.writeFile(outFile, JSON.stringify(packet, null, 2));

console.log(`First controlled test plan: ${outFile}`);
console.log(`Character: ${plan.character.name}`);
console.log(`Jobs: ${plan.totals.jobs} (hard cap: 1 image)`);
console.log(`Stack: ${CHARACTER_STILL_STACK_ID}`);
console.log("THIS SCRIPT DOES NOT SUBMIT A GENERATION.");
console.log("CHARACTER_FACTORY_LIVE_ENABLED and LIVE_RENDERING_ENABLED stay false in the repo.");
console.log("Do not start RunPod from this command.");
