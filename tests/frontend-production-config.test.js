import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFrontendProductionConfig,
  parseWranglerToml,
} from "../scripts/frontend-production-config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const valid = `# --keep-vars preserves FPAI_CONTROL_TOKEN. Do not set LOCAL_DEV.
name = "fpai-film-studio"
[vars]
ACCESS_TEAM_DOMAIN = "black-dream-df71.cloudflareaccess.com"
ACCESS_AUD = "ce69ac4d6fad40fd463939b248b4dbec611d2e315370486dc00a03782d680d47"
VIDEO_ADAPTER_URL = "https://fpai-film-studio-video-adapter.tjfalkahn.workers.dev"
[[services]]
binding = "VIDEO_ADAPTER"
service = "fpai-film-studio-video-adapter"
`;

test("TOML parser ignores comments that mention LOCAL_DEV and FPAI_CONTROL_TOKEN", () => {
  const parsed = parseWranglerToml(valid);
  assert.equal(parsed.vars.LOCAL_DEV, undefined);
  assert.equal(parsed.vars.FPAI_CONTROL_TOKEN, undefined);
  assert.equal(Object.hasOwn(parsed.vars, "LOCAL_DEV"), false);
  assert.doesNotThrow(() => assertFrontendProductionConfig(valid));
});

test("production frontend config vars keep Access and VIDEO_ADAPTER without local bypass", () => {
  const toml = readFileSync(join(root, "wrangler.frontend.production.toml"), "utf8");
  assert.match(toml, /FPAI_CONTROL_TOKEN/);
  assert.match(toml, /LOCAL_DEV/);
  const parsed = assertFrontendProductionConfig(toml);
  assert.equal(parsed.vars.ACCESS_TEAM_DOMAIN, "black-dream-df71.cloudflareaccess.com");
  assert.equal(parsed.services[0].binding, "VIDEO_ADAPTER");
});

test("LOCAL_DEV or FPAI_CONTROL_TOKEN in [vars] fail closed", () => {
  assert.throws(
    () => assertFrontendProductionConfig(valid.replace("[vars]", "[vars]\nLOCAL_DEV = \"true\"")),
    /LOCAL_DEV/,
  );
  assert.throws(
    () => assertFrontendProductionConfig(valid.replace(
      "VIDEO_ADAPTER_URL = \"https://fpai-film-studio-video-adapter.tjfalkahn.workers.dev\"",
      "FPAI_CONTROL_TOKEN = \"leaked\"\nVIDEO_ADAPTER_URL = \"https://fpai-film-studio-video-adapter.tjfalkahn.workers.dev\"",
    )),
    /FPAI_CONTROL_TOKEN/,
  );
});
