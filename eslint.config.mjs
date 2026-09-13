import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Build output is not source; without this, flat config lints .next/ too.
  { ignores: [".next/", "node_modules/", "out/"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Athlete profiles and WHOOP payloads live in JSONB columns and come
      // back untyped. Flag `any` so it stays visible, but do not fail on it.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

export default eslintConfig;
