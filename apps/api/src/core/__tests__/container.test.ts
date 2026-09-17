import { createLogger } from "@repo/logger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../config/index.js";
import { buildContainer } from "../container.js";
import { createDb, type DbClient } from "../db/index.js";
import type { MailSender } from "../mail/index.js";

/**
 * The composition root's surface, pinned (ADR-0073 §10).
 *
 * `D20.6` moved three hundred lines out of `core/container.ts` into one
 * `wire<Module>` per module. That is a **behaviour-preserving** split, and
 * "behaviour-preserving" for a composition root means one thing above all
 * others: everything the routers mount is still built, still once, and still
 * under the same name.
 *
 * **What the compiler already catches, this file does not claim to** (`D20.6`'s
 * `code-reviewer`): a controller *dropped* from a `wire*` return is a
 * `check-types` error where a router reads it, because `Container` is
 * `ReturnType<typeof buildContainer>`. What no type catches is a name **added
 * or renamed** without anyone noticing that the root's surface moved, and a
 * `wire*` that returns the key with nothing behind it — a conditional arm that
 * silently stopped producing its controller. Those are what the sets and the
 * defined-value loop below are for.
 *
 * The lists below are therefore **committed**, not derived: they are the sets
 * as they stood before the split, and a name that arrives or leaves has to be
 * written here by whoever changed it.
 */

/** Every repository the root exposes, as `D20.5` left them. */
const REPOSITORY_NAMES = [
  "handoffs",
  "invitations",
  "memberships",
  "organizations",
  "sessions",
  "settings",
  "staff",
  "users",
] as const;

/** Every service the root exposes, as `D20.5` left them. */
const SERVICE_NAMES = [
  "federatedSignIn",
  "health",
  "impersonation",
  "organizations",
  "settings",
  "staff",
  "staffAuth",
  "userAuth",
  "users",
] as const;

/** Every controller the segment routers mount, as `D20.5` left them. */
const CONTROLLER_NAMES = [
  "federated",
  "health",
  "impersonation",
  "organizations",
  "publicInvitations",
  "settings",
  "staff",
  "staffAuth",
  "staffProfile",
  "userAuth",
  "userInvitations",
  "userOrganizations",
  "userProfile",
  "users",
] as const;

/**
 * Every limiter `createRateLimiters` returns, as `D20.4` left them — the five
 * budgets of ADR-0020 and ADR-0057 plus the mail flows' and ADR-0073 §1's
 * per-principal one.
 */
const LIMITER_NAMES = [
  "emailChangeMailbox",
  "federatedCallback",
  "federatedStart",
  "global",
  "impersonation",
  "invitationLookup",
  "invitationMailbox",
  "login",
  "mailSource",
  "mailbox",
  "onboardingAccept",
  "passwordReset",
  "passwordResetSubmit",
  "principalHash",
  "refresh",
  "setPasswordLink",
  "staffOnboardingMailbox",
  "verification",
] as const;

const DATABASE_URL = "postgres://machxi:machxi@localhost:5432/machxi";

/**
 * The root builds; it does not connect — which is what makes this a unit test
 * rather than a sixteenth integration file (ADR-0021).
 *
 * A **real** client, because several repositories compose a query fragment at
 * construction (`invitations` builds its live-organization `exists` clause
 * there), so a hand-made stub would only be testing the stub. postgres.js opens
 * no socket until a query runs and nothing here runs one, so no database is
 * needed and `close()` has nothing to wait for.
 */
let db: DbClient;

beforeAll(() => {
  db = createDb(DATABASE_URL, { max: 1 });
});

afterAll(async () => {
  await db.close();
});

/** The ADR-0066 §1 port, so no transport is constructed here. */
const stubMail: MailSender = { send: () => Promise.resolve() };

const build = (env: Record<string, string> = {}) =>
  buildContainer({
    config: loadConfig({
      NODE_ENV: "development",
      DATABASE_URL,
      JWT_ACCESS_SECRET: "a".repeat(32),
      ...env,
    }),
    db,
    logger: createLogger({ level: "silent", name: "container-test" }),
    mail: stubMail,
  });

/**
 * What `wireAuth` needs before it builds the sign-in with Google (ADR-0072
 * §2). The schema refuses half a pair, so both halves are stated; the adapter
 * built from them talks to nobody here, because nothing calls it.
 */
const WITH_GOOGLE = {
  GOOGLE_CLIENT_ID: "container-test.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "container-test-secret",
} as const;

const names = (value: object): string[] => Object.keys(value).sort();

describe("buildContainer", () => {
  it("exposes every repository the split moved into a module", () => {
    expect(names(build().repositories)).toEqual([...REPOSITORY_NAMES]);
  });

  it("exposes every service the split moved into a module", () => {
    expect(names(build().services)).toEqual([...SERVICE_NAMES]);
  });

  it("exposes every controller the segment routers mount", () => {
    expect(names(build().controllers)).toEqual([...CONTROLLER_NAMES]);
  });

  it("exposes every limiter, built once at the root", () => {
    expect(names(build().rateLimiters)).toEqual([...LIMITER_NAMES]);
  });

  it("builds every controller but the one the configuration decides", () => {
    // `federated` is present exactly when the Google client is configured
    // (ADR-0072 §2), and this environment configures none — so it is the one
    // name that is a key with no value. Everything else being defined is what
    // a name-set assertion alone would not catch: a `wire*` that returned the
    // key and forgot the factory.
    const { controllers, services } = build();

    expect(controllers.federated).toBeUndefined();
    expect(services.federatedSignIn).toBeUndefined();

    for (const [name, controller] of Object.entries(controllers)) {
      if (name === "federated") continue;

      expect(controller, name).toBeDefined();
    }
  });

  it("builds the federated pair when the Google client is configured", () => {
    // The one conditional arm inside a `wire*` (`D20.6`'s `code-reviewer`):
    // with no client configured every assertion above passes whether or not
    // `wireAuth` can still build the flow at all, and the branch is otherwise
    // reached only by the integration tier, which injects its own provider.
    const { controllers, services } = build(WITH_GOOGLE);

    expect(controllers.federated).toBeDefined();
    expect(services.federatedSignIn).toBeDefined();

    // And the names do not move with the configuration: the two keys are
    // present either way, which is what the segment routers read.
    expect(names(controllers)).toEqual([...CONTROLLER_NAMES]);
    expect(names(services)).toEqual([...SERVICE_NAMES]);
  });

  it("gives each container its own limiter instances", () => {
    // The whole reason the limiters are built at the root (ADR-0009): an
    // instance holds the counter, so two processes — or two integration
    // apps in one file — must not find themselves sharing a budget.
    expect(build().rateLimiters.principalHash).not.toBe(
      build().rateLimiters.principalHash,
    );
  });
});
