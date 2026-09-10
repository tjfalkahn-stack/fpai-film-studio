import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    proxy: Object.fromEntries(
      ["/api", "/health"].map((path) => [
        path,
        {
          target: "http://127.0.0.1:8787",
          headers: { authorization: "Bearer local-mock-only-token" },
        },
      ]),
    ),
  },
});
