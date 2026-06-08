// Flat ESLint config shared across the workspace. Kept deliberately small: the
// TypeScript compiler in strict mode is the heavy static gate, so ESLint here
// just catches the lint-class issues tsc does not, like unused values.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "examples/cassettes/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused vars are a smell, but a leading underscore is the conventional
      // way to say "intentionally ignored", so honor it.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Tests and config files lean on globals and occasional loose typing.
    files: ["**/*.test.ts", "**/*.config.*", "**/scripts/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
