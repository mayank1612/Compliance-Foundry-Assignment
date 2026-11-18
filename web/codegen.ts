/**
 * codegen.ts — typed GraphQL documents for the web app (`npm run gql:codegen -w web`).
 *
 * What: reads the API's SDL (the single contract) and every `graphql(`…`)` document
 *       in src/, and generates src/gql/: a typed `graphql()` function, so `useQuery`
 *       results and variables are fully typed — a field the API doesn't serve is a
 *       compile error in the UI, not a runtime `undefined`.
 */
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: '../api/src/graphql/schema.graphql',
  documents: ['src/**/*.{ts,tsx}', '!src/gql/**'],
  generates: {
    'src/gql/': {
      preset: 'client',
      // Fragments are colocated with the components that use them, but not masked:
      // simpler typing for a single-team codebase.
      presetConfig: { fragmentMasking: false },
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        strictScalars: true,
        scalars: { Date: 'string', DateTime: 'string' }, // both arrive as ISO strings
        // Apollo adds __typename to every selection set at runtime; say so in the
        // types, so optimistic responses and test mocks must include it too.
        nonOptionalTypename: true,
      },
    },
  },
};

export default config;
