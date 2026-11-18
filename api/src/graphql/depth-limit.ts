/**
 * depth-limit.ts — reject over-nested queries before they execute.
 *
 * What: a GraphQL validation rule that measures how deeply an operation nests
 *       selection sets (following fragments) and rejects it beyond a maximum.
 * Why:  `first` is capped at 100 per list (validation.ts), but caps multiply along a
 *       path: viewer → memberships → organization → projects → statuses → tasks would
 *       fan out to hundreds of thousands of cards in one request (critique finding
 *       N2 recommended a depth/cost limit). The board needs depth 7
 *       (project → statuses → tasks → edges → node → assignee → field); 10 leaves room
 *       while blocking the multi-organization fan-out.
 * Note: introspection fields (`__schema`, `__type`) are skipped, so GraphiQL works.
 */
import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql';

export const MAX_QUERY_DEPTH = 10;

export function maxDepthRule(maxDepth: number) {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION)
        fragments.set(definition.name.value, definition);
    }

    /** Deepest nesting below this selection set; `seen` stops fragment cycles. */
    const depthOf = (selectionSet: SelectionSetNode, depth: number, seen: Set<string>): number => {
      let deepest = depth;
      for (const selection of selectionSet.selections) {
        if (selection.kind === Kind.FIELD) {
          if (selection.name.value.startsWith('__') || !selection.selectionSet) continue;
          deepest = Math.max(deepest, depthOf(selection.selectionSet, depth + 1, seen));
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          deepest = Math.max(deepest, depthOf(selection.selectionSet, depth, seen));
        } else {
          const name = selection.name.value;
          const fragment = fragments.get(name);
          if (fragment && !seen.has(name)) {
            deepest = Math.max(
              deepest,
              depthOf(fragment.selectionSet, depth, new Set(seen).add(name)),
            );
          }
        }
      }
      return deepest;
    };

    return {
      OperationDefinition(operation) {
        const depth = depthOf(operation.selectionSet, 1, new Set());
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(`Query is nested ${depth} levels deep; the maximum is ${maxDepth}`, {
              nodes: [operation],
              extensions: { code: 'BAD_USER_INPUT' },
            }),
          );
        }
      },
    };
  };
}
