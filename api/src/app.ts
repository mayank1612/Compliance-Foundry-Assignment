/**
 * app.ts — builds the GraphQL HTTP application (GraphQL Yoga), without listening.
 *
 * What: schema + resolvers, authentication, CORS, query-depth limit, the
 *       per-operation transaction, and (development only) the /dev/users route.
 * Why separate from server.ts: tests drive this exact app in-process through
 *       `yoga.fetch(...)` — same code path as production, no port, no network.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSchema, createYoga, type Plugin } from 'graphql-yoga';
import { sql, type Kysely } from 'kysely';
import type { TokenService } from './auth/tokens.js';
import type { DB } from './db/types.js';
import type { GraphQLContext, RequestContext } from './graphql/context.js';
import { MAX_QUERY_DEPTH, maxDepthRule } from './graphql/depth-limit.js';
import { apiError } from './graphql/errors.js';
import { resolvers } from './graphql/resolvers.js';
import { useRequestTransaction } from './graphql/transaction-plugin.js';
import { API_ROOT } from './paths.js';

/** The contract, read once at start-up — the same file codegen generates types from. */
const typeDefs = readFileSync(resolve(API_ROOT, 'src', 'graphql', 'schema.graphql'), 'utf8');

export interface AppOptions {
  /** Owner-level handle. Resolvers never see it — they get an RLS transaction. */
  db: Kysely<DB>;
  tokens: TokenService;
  /** Browser origin allowed by CORS (the web app's dev server). */
  corsOrigin: string;
  /** Development conveniences: GraphiQL and /dev/users. Never in production. */
  devRoutes: boolean;
}

/** `Authorization: Bearer <token>` → user id; no header → anonymous (null). */
async function authenticate(request: Request, tokens: TokenService): Promise<string | null> {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw apiError('UNAUTHENTICATED', 'Authorization header must be "Bearer <token>"', 401);
  }
  try {
    return await tokens.verify(token);
  } catch {
    throw apiError('UNAUTHENTICATED', 'Invalid or expired token', 401);
  }
}

/** Reject over-nested operations at validation time (depth-limit.ts). */
const depthLimit: Plugin = {
  onValidate({ addValidationRule }) {
    addValidationRule(maxDepthRule(MAX_QUERY_DEPTH));
  },
};

/**
 * DEVELOPMENT ONLY — GET /dev/users: every seeded user with their memberships and
 * a ready-to-use access token. Powers the web app's "view as" switcher, standing in
 * for a login screen (authentication is out of scope). Deliberately reads with the
 * owner handle (it must list users across tenants), which is exactly why it is
 * never registered when NODE_ENV=production.
 */
function useDevUsersRoute(db: Kysely<DB>, tokens: TokenService, corsOrigin: string): Plugin {
  const headers = { 'access-control-allow-origin': corsOrigin, vary: 'Origin' };
  return {
    // `request` keeps endResponse bound to its object (no unbound-method extraction).
    async onRequest(request) {
      if (request.url.pathname !== '/dev/users') return;
      const users = await db
        .selectFrom('users as u')
        .leftJoin('organizationMembers as m', 'm.userId', 'u.id')
        .leftJoin('organizations as o', 'o.id', 'm.organizationId')
        .select(['u.id', 'u.displayName', 'u.email'])
        .select(
          sql<{ organization: string; slug: string; role: string }[]>`coalesce(
            json_agg(json_build_object('organization', o.name, 'slug', o.slug, 'role', m.role)
                     ORDER BY o.name) FILTER (WHERE o.id IS NOT NULL), '[]')`.as('memberships'),
        )
        .groupBy(['u.id', 'u.displayName', 'u.email'])
        .orderBy('u.displayName')
        .execute();
      const body = await Promise.all(
        users.map(async (user) => ({ ...user, token: await tokens.sign(user.id) })),
      );
      request.endResponse(request.fetchAPI.Response.json(body, { headers }));
    },
  };
}

export function createApp(options: AppOptions) {
  // <server context, per-request context>: Node's http server adds nothing we use.
  // The schema's context (GraphQLContext) extends RequestContext with the db +
  // loaders that the transaction plugin adds right before execution.
  return createYoga<object, RequestContext>({
    schema: createSchema<GraphQLContext>({ typeDefs, resolvers }),
    graphqlEndpoint: '/graphql',
    context: async ({ request }) => ({ viewerId: await authenticate(request, options.tokens) }),
    cors: {
      origin: options.corsOrigin,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['content-type', 'authorization'],
    },
    plugins: [
      depthLimit,
      useRequestTransaction(options.db),
      ...(options.devRoutes
        ? [useDevUsersRoute(options.db, options.tokens, options.corsOrigin)]
        : []),
    ],
    // Unexpected errors (incl. database messages) become "Unexpected error." —
    // only GraphQLErrors from graphql/errors.ts reach clients.
    maskedErrors: true,
    graphiql: options.devRoutes ? { title: 'Task Board API' } : false,
    landingPage: false,
  });
}

export type App = ReturnType<typeof createApp>;
