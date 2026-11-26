import { defineConfig } from "vitest/config";

// Le test de chaos (chaos/) ne tourne que par `make chaos`, sur la pile du Compose.
export default defineConfig({ test: { include: ["src/**/*.test.ts"], globalSetup: "./src/global-setup.ts" } });
