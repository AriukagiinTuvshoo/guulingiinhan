import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'backend/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts', '.cloudflare/**']),
  { rules: { '@next/next/no-img-element': 'off', 'react-hooks/set-state-in-effect': 'warn', 'react-hooks/preserve-manual-memoization': 'warn' } },
]);
