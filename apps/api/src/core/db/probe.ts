import type { Logger } from "@repo/logger";

/**
 * The startup connectivity probe (ADR-0003).
 *
 * The database is a hard dependency: an API that binds its port without one
 * answers every request with a 500 and still looks healthy to a naive
 * deployment. Failing to start instead is what makes a rollout stop.
 *
 * Retrying is for the ordinary local case — `pnpm dev` racing a Postgres
 * container that is still opening its socket — not for tolerating an outage.
 */
export interface ProbeDatabaseOptions {
  readonly ping: () => Promise<void>;
  /** `DB_CONNECT_RETRIES` (ADR-0004); the first attempt is not a retry. */
  readonly attempts: number;
  readonly delayMs?: number;
  readonly logger: Logger;
  /** Test seam; the default sleeps for real. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pings until it succeeds or the attempts run out.
 *
 * @throws the driver's last error, so `main.ts` logs what actually failed
 *   (wrong password, no route to host) rather than "database unreachable".
 */
export const probeDatabase = async ({
  ping,
  attempts,
  delayMs = 1000,
  logger,
  sleep = defaultSleep,
}: ProbeDatabaseOptions): Promise<void> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await ping();

      logger.info({ attempt }, "database connected");

      return;
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        logger.warn(
          { attempt, attempts, err: error },
          "database not ready, retrying",
        );
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
};
