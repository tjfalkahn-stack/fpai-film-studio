import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_ACCESS_TEAM = "black-dream-df71.cloudflareaccess.com";
const PRODUCTION_ACCESS_AUD = "6e7f30290052789eb600d8f444f927c89d2159a4d3df4434777397fbd4163271";

function stripTomlComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== "\\") inString = !inString;
    if (ch === "#" && !inString) return line.slice(0, i);
  }
  return line;
}

function unquoteToml(value) {
  const trimmed = String(value || "").trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return JSON.parse(trimmed);
  return trimmed;
}

export function parseWranglerToml(text) {
  const vars = {};
  const services = [];
  const root = {};
  let section = "root";
  let currentService = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = stripTomlComment(raw).trim();
    if (!line) continue;
    const arrayTable = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayTable) {
      section = arrayTable[1];
      currentService = {};
      if (section === "services") services.push(currentService);
      continue;
    }
    const table = line.match(/^\[([^\]]+)\]$/);
    if (table) {
      section = table[1];
      currentService = null;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const value = unquoteToml(kv[2]);
    if (section === "vars") vars[kv[1]] = value;
    else if (section === "services" && currentService) currentService[kv[1]] = value;
    else if (section === "root") root[kv[1]] = value;
  }
  return { root, vars, services };
}

export function assertFrontendProductionConfig(text) {
  const parsed = parseWranglerToml(text);
  if (Object.hasOwn(parsed.vars, "LOCAL_DEV")) {
    throw new Error("Production frontend [vars] must not set LOCAL_DEV.");
  }
  if (Object.hasOwn(parsed.vars, "FPAI_CONTROL_TOKEN")) {
    throw new Error("Production frontend [vars] must not set FPAI_CONTROL_TOKEN; keep it as a Worker secret.");
  }
  if (parsed.vars.ACCESS_TEAM_DOMAIN !== PRODUCTION_ACCESS_TEAM) {
    throw new Error("Production frontend ACCESS_TEAM_DOMAIN must remain the owner Access team domain.");
  }
  if (parsed.vars.ACCESS_AUD !== PRODUCTION_ACCESS_AUD) {
    throw new Error("Production frontend ACCESS_AUD must remain the owner Access application AUD.");
  }
  const adapter = parsed.services.find((service) => service.binding === "VIDEO_ADAPTER");
  if (!adapter || adapter.service !== "fpai-film-studio-video-adapter") {
    throw new Error("Production frontend must keep the VIDEO_ADAPTER service binding.");
  }
  return parsed;
}

const isDirectRun = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "wrangler.frontend.production.toml");
  assertFrontendProductionConfig(readFileSync(file, "utf8"));
  console.log("frontend production config keeps VIDEO_ADAPTER and owner-only Access");
}
