import fs from "node:fs/promises";
import path from "node:path";
import { createCharacterFactoryPlan } from "../src/characterFactory.js";

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const characterFile = getArg("--character", "benchmarks/marcus.character.json");
const medium = getArg("--medium", "cinematic");
const outDir = getArg("--out", "benchmarks/output");

const raw = JSON.parse(await fs.readFile(characterFile, "utf8"));
const plan = createCharacterFactoryPlan({ ...raw, medium });

await fs.mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `${plan.character.id}.${medium}.plan.json`);
await fs.writeFile(outFile, JSON.stringify(plan, null, 2));

console.log(`Character Factory v${plan.version}`);
console.log(`Character: ${plan.character.name}`);
console.log(`Medium: ${plan.mediumLabel}`);
console.log(`Jobs: ${plan.totals.jobs}`);
console.log(`Plan: ${outFile}`);
console.log("No render request was submitted. This command only creates the benchmark plan.");
