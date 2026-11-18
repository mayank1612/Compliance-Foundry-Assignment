// What:  ESLint flat config for the whole monorepo (api/ and web/).
// Why:   type-aware linting catches bugs the compiler allows — floating promises
//        (a forgotten `await` on a DB write), unsafe `any` flowing out of JSON,
//        misused async callbacks; in web/, broken hook rules and stale effects.
// Who:   run by `npm run lint`, by `npm run check`, and in CI.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // Never lint generated or build output. `api/src/db/types.ts` is produced by
  // kysely-codegen from the live schema — fixing lint there would be overwritten.
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.pglite/**',
      'api/src/db/types.ts',
      'api/src/graphql/generated/**',
      'web/src/gql/**',
    ],
  },

  // Baseline: ESLint's recommended JS rules + typescript-eslint's strictest preset
  // that uses type information.
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,

  // How type information is found: the "project service" asks each workspace's
  // nearest tsconfig.json, so new packages need no extra lint config.
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      // Numbers in template strings (`port ${port}`) are harmless and common in logs.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  // Plain JS config files (like this one) are not in any tsconfig, so type-aware
  // rules cannot run on them.
  { files: ['**/*.js', '**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },

  // React app: the Rules of Hooks + React Compiler-era checks (stale deps, setState
  // in effects, impure renders), Fast Refresh boundaries, and browser globals.
  {
    files: ['web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Tests may assert "this is present" with `!`: if the assumption is wrong the
  // test fails loudly at that line, which is exactly what a test should do.
  // Application code must narrow explicitly (see the `required()` helpers).
  {
    files: ['**/test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },

  // Last: turn off every stylistic rule Prettier owns, so the two never fight.
  prettier,
);
