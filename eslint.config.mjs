import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([".next/**", ".next-build/**", ".next-build-*/**", "node_modules/**", "source/**", "architecture/**", "demo-site/.next/**", "demo-site/out/**", "demo-site/public/**"]),
]);
