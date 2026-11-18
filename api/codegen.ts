/**
 * codegen.ts — GraphQL Code Generator config for the API (`npm run gql:codegen -w api`).
 *
 * What: reads src/graphql/schema.graphql and writes TypeScript types for every
 *       resolver (arguments, parent object, return value, context).
 * Why:  the SDL is the contract; if a resolver drifts from it (wrong argument name,
 *       missing field, wrong return shape), `tsc` fails before anything runs.
 *       `npm run check` runs this with `--check`, so a stale file fails CI.
 */
import type { CodegenConfig } from '@graphql-codegen/cli';

/** GraphQL enums are UPPER_CASE; Postgres enums are lower_case. */
const lowerCaseValues = (values: string[]) =>
  Object.fromEntries(values.map((value) => [value, value.toLowerCase()]));

const config: CodegenConfig = {
  schema: 'src/graphql/schema.graphql',
  generates: {
    'src/graphql/generated/resolvers-types.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        useTypeImports: true, // `import type` — required by verbatimModuleSyntax
        enumsAsTypes: true, // string unions, not TS enums (erasable syntax)
        strictScalars: true, // every custom scalar must be mapped below
        useIndexSignature: true, // makes the Resolvers type assignable to Yoga's createSchema
        contextType: '../context.js#GraphQLContext',
        scalars: {
          DateTime: { input: 'Date', output: 'Date | string' },
          Date: 'string', // 'YYYY-MM-DD' — never a JS Date (no time-zone shift)
        },
        // Resolvers see the database values; graphql-js maps them to/from the
        // public names (the enum resolvers in resolvers.ts declare the same mapping).
        enumValues: {
          OrganizationRole: lowerCaseValues(['VIEWER', 'MEMBER', 'ADMIN', 'OWNER']),
          TaskPriority: lowerCaseValues(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']),
          StatusCategory: lowerCaseValues([
            'BACKLOG',
            'UNSTARTED',
            'STARTED',
            'COMPLETED',
            'CANCELED',
          ]),
        },
        mappers: {
          User: '../models.js#UserModel',
          Viewer: '../models.js#ViewerModel',
          Organization: '../models.js#OrganizationModel',
          OrganizationSettings: '../models.js#OrganizationSettingsModel',
          OrganizationMember: '../models.js#OrganizationMemberModel',
          Project: '../models.js#ProjectModel',
          TaskStatus: '../models.js#TaskStatusModel',
          Label: '../models.js#LabelModel',
          Task: '../models.js#TaskModel',
          TaskSummary: '../models.js#TaskSummaryModel',
          StatusCount: '../models.js#StatusCountModel',
          AssigneeCount: '../models.js#AssigneeCountModel',
        },
      },
    },
  },
};

export default config;
