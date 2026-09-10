import { spawn, spawnSync } from "node:child_process";
const local = ["--config", "wrangler.render.local.toml"];
for (const file of ["worker/schema.sql", "worker/render-schema.sql", "worker/character-schema.sql"]) {
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "fpai-film-studio-generation",
      ...local,
      "--local",
      `--file=${file}`,
    ],
    { stdio: "inherit" },
  );
  if (result.status) process.exit(result.status);
}
const children = [
  spawn(
    "npx",
    ["wrangler", "dev", ...local, "--ip", "127.0.0.1", "--port", "8787"],
    { stdio: "inherit" },
  ),
  spawn("npx", ["vite", ...process.argv.slice(2)], { stdio: "inherit" }),
];
function stop() {
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children)
  child.on("exit", (code) => {
    stop();
    process.exitCode = code || 0;
  });
