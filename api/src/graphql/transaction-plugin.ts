/**
 * transaction-plugin.ts — one database transaction per GraphQL operation, as the
 * caller, under row-level security.
 *
 * What: wraps Yoga's execute step so the whole operation runs inside
 *       withUserContext(): `SET LOCAL ROLE app_user` + `app.user_id = <viewer>`.
 *       Resolvers get that transaction as `ctx.db` and loaders bound to it.
 * Why:  (1) Tenant isolation is enforced by Postgres for every resolver, including
 *       ones written later — there is no unscoped handle to forget about.
 *       (2) A mutation either fully applies or not at all: if any resolver in a
 *       mutation reports an error, the transaction is rolled back.
 *       (3) Reads within one operation see one consistent snapshot of the board.
 * Trade-off (Task 1.3 analysis): the connection is held for the whole operation,
 * so resolvers must only await the database — never slow external calls.
 */
import {
  getOperationAST,
  Kind,
  type DocumentNode,
  type ExecutionArgs,
  type ExecutionResult,
} from 'graphql';
import type { Plugin } from 'graphql-yoga';
import type { Kysely } from 'kysely';
import { withUserContext } from '../db/request-context.js';
import type { DB } from '../db/types.js';
import type { RequestContext } from './context.js';
import { apiError } from './errors.js';
import { createLoaders } from './loaders.js';

/** Thrown inside the transaction to roll it back after a failed mutation. */
class RollbackSignal extends Error {}

/** `{ __schema … }` / `{ __typename }` only — what GraphiQL needs before sign-in. */
function isIntrospectionOnly(document: DocumentNode, operationName?: string | null): boolean {
  const operation = getOperationAST(document, operationName);
  return (
    !!operation &&
    operation.selectionSet.selections.every(
      (selection) => selection.kind === Kind.FIELD && selection.name.value.startsWith('__'),
    )
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

export function useRequestTransaction(db: Kysely<DB>): Plugin {
  return {
    onExecute({ executeFn, setExecuteFn }) {
      // envelop types these hook arguments loosely (`any`); pin them to graphql's types.
      setExecuteFn(async (args: ExecutionArgs) => {
        const request = args.contextValue as RequestContext;

        // Everything except introspection requires a signed-in user.
        if (!request.viewerId && !isIntrospectionOnly(args.document, args.operationName)) {
          return {
            errors: [
              apiError(
                'UNAUTHENTICATED',
                'Sign in required: send "Authorization: Bearer <token>"',
                401,
              ),
            ],
          };
        }

        const isMutation =
          getOperationAST(args.document, args.operationName)?.operation === 'mutation';
        let result: ExecutionResult | undefined;
        try {
          await withUserContext(db, request.viewerId, async (trx) => {
            const executed: unknown = await executeFn({
              ...args,
              contextValue: { ...request, db: trx, loaders: createLoaders(trx, request.viewerId) },
            });
            // @defer/@stream would outlive the transaction; the schema doesn't use them.
            if (isAsyncIterable(executed)) throw new Error('Incremental delivery is not supported');
            const single = executed as ExecutionResult;
            result = single;
            if (isMutation && single.errors?.length) throw new RollbackSignal();
          });
        } catch (error) {
          if (!(error instanceof RollbackSignal)) throw error;
        }
        // Set on every path that reaches here (the rollback path assigns it first).
        return result ?? { errors: [apiError('CONFLICT', 'The operation could not complete')] };
      });
    },
  };
}
