/**
 * Postgres error introspection that survives Drizzle's wrapping.
 *
 * A driver-level failure does NOT arrive as a flat error: Drizzle catches the
 * `postgres.js` error and rethrows a `DrizzleQueryError` whose own `code` is
 * `undefined`, hanging the original `PostgresError` (which carries `code`,
 * `constraint_name`, `detail`) off `.cause`. A `error.code === "23505"` check
 * written against the driver's shape therefore silently never matches, and the
 * raw "Failed query: insert into ... params: ..." message reaches the caller —
 * a wrong answer AND an internals leak. Walk the cause chain instead.
 */

/** unique_violation */
export const PG_UNIQUE_VIOLATION = "23505";
/** foreign_key_violation */
export const PG_FOREIGN_KEY_VIOLATION = "23503";

type PgErrorish = {
  code?: unknown;
  constraint_name?: unknown;
  constraint?: unknown;
  cause?: unknown;
};

/** Nested `cause` chains are shallow in practice; the cap just stops a cycle. */
const MAX_CAUSE_DEPTH = 5;

function findPgError(error: unknown, depth = 0): PgErrorish | null {
  if (depth > MAX_CAUSE_DEPTH || typeof error !== "object" || error === null) {
    return null;
  }

  const candidate = error as PgErrorish;
  // Postgres SQLSTATEs are always exactly 5 characters.
  if (typeof candidate.code === "string" && candidate.code.length === 5) {
    return candidate;
  }

  return findPgError(candidate.cause, depth + 1);
}

/** The SQLSTATE of the underlying Postgres error, wherever it's buried. */
export function pgErrorCode(error: unknown): string | null {
  const pgError = findPgError(error);
  return typeof pgError?.code === "string" ? pgError.code : null;
}

/**
 * The violated constraint/index name. postgres.js reports this as
 * `constraint_name`; other drivers use `constraint`, so accept both.
 */
export function pgConstraintName(error: unknown): string | null {
  const pgError = findPgError(error);
  const name = pgError?.constraint_name ?? pgError?.constraint;
  return typeof name === "string" ? name : null;
}

/**
 * Is this a unique violation — optionally, of one specific constraint?
 *
 * Pass `constraint` whenever the caller turns the violation into a specific
 * user-facing message, so an unrelated unique index on the same table can't be
 * reported as the wrong thing.
 */
export function isUniqueViolation(
  error: unknown,
  constraint?: string
): boolean {
  if (pgErrorCode(error) !== PG_UNIQUE_VIOLATION) return false;
  if (!constraint) return true;
  return pgConstraintName(error) === constraint;
}
