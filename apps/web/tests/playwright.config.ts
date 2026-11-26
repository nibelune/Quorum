import { defineConfig } from "@playwright/test";

// Lancé par `make e2e`, dans l'image officielle de Playwright, sur la pile démarrée par `make up`.
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: process.env["BASE_URL"] ?? "http://localhost:8080",
    trace: "retain-on-failure",
  },
});
