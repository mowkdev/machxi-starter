/**
 * The test database's name, and the lane family it belongs to (ADR-0021,
 * ADR-0082 §3).
 *
 * Pure: no environment, no connection, no import. It sits under `tooling/`
 * because `env.ts` applies the lane when it reads a test URL, and
 * `@repo/db/testing` re-exports it for the API's harness; a module in the
 * middle is what lets both use one implementation without `env.ts` importing
 * the destructive entry point.
 */

/**
 * The suffix a database must carry before the harness will drop its schema.
 *
 * `resetSchema` takes whatever URL it is given, and the `NODE_ENV=production`
 * refusal lives in the `db:reset` CLI wrapper, which this path does not go
 * through. A `DATABASE_URL_TEST` copy-pasted from `DATABASE_URL` — the
 * likeliest way to get this wrong — would otherwise drop the developer's dev
 * schema on `pnpm test:int` (ADR-0008 §Environment guardrails).
 */
export const TEST_DATABASE_SUFFIX = "_test";

/**
 * The longest name Postgres keeps. A longer one is truncated without an
 * error, and the part cut off is the `_test` suffix the guard reads — so a
 * lane name past it is refused here rather than created as something else.
 */
const MAX_DATABASE_NAME_BYTES = 63;

/**
 * A lane as `pnpm db:lane` prints it: the branch's slug — lower-case letters
 * and digits in runs joined by single hyphens.
 */
const LANE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const databaseOf = (url: string): string =>
  decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));

/** Throws unless `url` names a database whose name ends in `_test`. */
export const assertTestDatabase = (url: string): void => {
  const database = databaseOf(url);

  if (!database.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to reset "${database}": the test database URL must name a database ending in "${TEST_DATABASE_SUFFIX}" (ADR-0007 creates machxi_test for exactly this).`,
    );
  }
};

/**
 * `url` pointed at the lane's database — `machxi_test` becomes
 * `machxi_<lane>_test` — or `url` itself when `lane` is `undefined`
 * (ADR-0082 §3). A lane that is set but empty is refused.
 *
 * The suffix guard is applied on **both sides**: the URL the lane is derived
 * from must already name a `_test` database, so a lane can never turn a
 * development URL into one that passes the guard, and the result is checked
 * again before it is returned. A URL already on the lane's database is
 * returned unchanged, so a harness that reads a rewritten URL back from the
 * environment does not stack the lane twice.
 */
export const laneDatabaseUrl = (
  url: string,
  lane: string | undefined,
): string => {
  if (lane === undefined) return url;

  // Set but empty is refused, not read as unset: it is what
  // `export TEST_DB_LANE=$(pnpm --silent db:lane)` leaves behind when
  // `db:lane` fails, and reading it as `machxi_test` would put the lane back
  // on the one database this rule exists to take it off.
  if (lane.trim() === "") {
    throw new Error(
      "TEST_DB_LANE is set but empty; re-run `export TEST_DB_LANE=$(pnpm --silent db:lane)` or unset it (ADR-0082 §3).",
    );
  }

  assertTestDatabase(url);

  if (!LANE_SLUG.test(lane)) {
    throw new Error(
      `TEST_DB_LANE must be a branch slug — lower-case letters, digits and single hyphens — as \`pnpm db:lane\` prints it; got ${JSON.stringify(lane)} (ADR-0082 §3).`,
    );
  }

  const database = databaseOf(url);
  const laneSuffix = `_${lane}${TEST_DATABASE_SUFFIX}`;

  if (database.endsWith(laneSuffix)) return url;

  const name = `${database.slice(0, -TEST_DATABASE_SUFFIX.length)}${laneSuffix}`;

  if (Buffer.byteLength(name) > MAX_DATABASE_NAME_BYTES) {
    throw new Error(
      `The lane database "${name}" is longer than the ${String(MAX_DATABASE_NAME_BYTES)} bytes Postgres keeps (ADR-0082 §3).`,
    );
  }

  const parsed = new URL(url);

  parsed.pathname = `/${name}`;

  const rewritten = parsed.toString();

  assertTestDatabase(rewritten);

  return rewritten;
};
