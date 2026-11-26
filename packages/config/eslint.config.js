import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["**/.svelte-kit/", "**/build/"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  svelte.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, extraFileExtensions: [".svelte"] },
    },
    rules: {
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    // TypeScript et svelte-check vérifient déjà les variables globales.
    rules: { "no-undef": "off" },
  },
  // Les configs restent en JS (ESLint 10 ne charge un .ts qu'avec jiti ou un flag instable) : hors de tout tsconfig, elles ne peuvent pas être lintées avec les types.
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
