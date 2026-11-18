/**
 * scalars.ts — the two custom scalars and how they cross the wire.
 *
 * DateTime: Postgres timestamptz → JS Date (pg driver) → ISO-8601 string with offset.
 * Date:     Postgres date stays a 'YYYY-MM-DD' string end to end (db/pool.ts keeps it
 *           a string), so a due date can never shift by a day with the server's or
 *           client's time zone. Input is validated to be a real calendar date.
 */
import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for real calendar dates only ('2026-02-30' is rejected). */
function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function parseDate(value: unknown): string {
  if (typeof value === 'string' && isCalendarDate(value)) return value;
  throw new GraphQLError('Date must be a calendar date in YYYY-MM-DD format', {
    extensions: { code: 'BAD_USER_INPUT' },
  });
}

// graphql 17 names: coerceOutputValue (was serialize), coerceInputValue (was
// parseValue), coerceInputLiteral (was parseLiteral). The old names are deprecated
// and removed in graphql 18; @graphql-tools forwards the new ones.
export const DateScalar = new GraphQLScalarType<string, string>({
  name: 'Date',
  description: 'A calendar date with no time or zone: `YYYY-MM-DD`.',
  coerceOutputValue: (value) => parseDate(value),
  coerceInputValue: (value) => parseDate(value),
  coerceInputLiteral: (ast) => parseDate(ast.kind === Kind.STRING ? ast.value : undefined),
});

function parseDateTime(value: unknown): Date {
  const parsed = typeof value === 'string' ? new Date(value) : undefined;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  throw new GraphQLError('DateTime must be an ISO-8601 timestamp', {
    extensions: { code: 'BAD_USER_INPUT' },
  });
}

export const DateTimeScalar = new GraphQLScalarType<Date, string>({
  name: 'DateTime',
  description: 'An instant in time: ISO-8601 with offset, e.g. `2026-11-16T09:30:00Z`.',
  coerceOutputValue: (value) => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return parseDateTime(value).toISOString();
    throw new GraphQLError('DateTime cannot represent this value');
  },
  coerceInputValue: (value) => parseDateTime(value),
  coerceInputLiteral: (ast) => parseDateTime(ast.kind === Kind.STRING ? ast.value : undefined),
});
