import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["chaos/**/*.test.ts"], testTimeout: 90_000 } });
