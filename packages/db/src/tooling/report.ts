/**
 * Terminal output for the `db:*` scripts (ADR-0008 §Environment guardrails:
 * "every db script prints the target host/db name (never credentials) before
 * acting").
 *
 * These are one-shot CLI tools run by a person or a deploy job, not the API's
 * request path, so they write plain lines to stdout rather than the pino JSON
 * of ADR-0005. Two reasons, both structural: `@repo/db` may depend only on
 * `@repo/crypto` and `@repo/contracts` (ADR-0002 §Shared conventions), so it
 * cannot import `@repo/logger`; and a migration log a human reads while
 * waiting is worse as JSON. `console.*` stays banned — `no-console` is on for
 * this package like every other.
 */

/** Writes one line to stdout. The `no-console`-clean way to talk to a terminal. */
export const writeLine = (message = ""): void => {
  process.stdout.write(`${message}\n`);
};

/** Writes one line to stderr, for warnings that must not pollute piped output. */
export const writeErrorLine = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

/**
 * Renders a connection string as `host:port/database` — enough to tell "I am
 * about to migrate the wrong database" from "this is the one I meant", with
 * the password structurally unable to appear.
 *
 * Built by reading the three fields out, never by masking the original string:
 * a redaction that works by substitution fails on the password that happens to
 * equal the host name.
 */
export const describeTarget = (connectionString: string): string => {
  try {
    const url = new URL(connectionString);
    const host = url.hostname === "" ? "?" : url.hostname;
    const port = url.port === "" ? "5432" : url.port;
    const database = url.pathname.replace(/^\//, "");

    return `${host}:${port}/${database === "" ? "?" : database}`;
  } catch {
    // A malformed URL must not be echoed back — it is the string that contains
    // the password.
    return "<unparsable connection string>";
  }
};
