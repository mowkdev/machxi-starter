import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_SESSIONS_PER_PRINCIPAL,
  build,
  context,
  resetClock,
} from "./auth.service.harness.js";

/**
 * The session mint's cap (ADR-0073 §3 as carried by ADR-0074 §4), against the
 * fake `sessions` table.
 *
 * What a fake can prove here is the service's half: that an ordinary mint asks
 * for the cap and an impersonated one does not, and — through the fake that
 * reproduces the repository's filter — that the count is the customer's own
 * sessions. The order the excess is taken in, against a real `created_at`,
 * is `auth-sessions.int.test.ts`'s.
 */

beforeEach(resetClock);

const CUSTOMER_ID = "33333333-3333-7333-8333-333333333333";
const ACTOR_ID = "44444444-4444-7444-8444-444444444444";
const CUSTOMER_EMAIL = "customer@machxi.local";
const PASSWORD = "correct-horse-battery";

/** A `user` service wired the way the container wires it (ADR-0057 §4). */
const buildCustomer = () =>
  build({
    population: "user",
    principals: [
      {
        id: CUSTOMER_ID,
        email: CUSTOMER_EMAIL,
        passwordHash: `hashed:${PASSWORD}`,
        active: true,
      },
    ],
    impersonators: [
      {
        id: ACTOR_ID,
        email: "operator@machxi.local",
        passwordHash: `hashed:${PASSWORD}`,
        active: true,
      },
    ],
  });

describe("the per-principal cap", () => {
  it("impersonated sessions neither count toward the cap nor are evicted by it", async () => {
    const harness = buildCustomer();

    // A full cap's worth of support sessions first, so they are the account's
    // **oldest** live rows — the ones an eviction would reach for, and a count
    // that included them would already stand at the cap (`SEC-09`).
    for (let opened = 0; opened < MAX_SESSIONS_PER_PRINCIPAL; opened += 1) {
      await harness.service.issueImpersonatedSession(context(), {
        principalId: CUSTOMER_ID,
        staffId: ACTOR_ID,
      });
    }

    const signIn = () =>
      harness.service.login(context(), {
        email: CUSTOMER_EMAIL,
        password: PASSWORD,
      });

    // The customer's own devices, up to the cap: nothing is revoked, because
    // the sessions somebody else opened are not the customer's to hold.
    for (let device = 0; device < MAX_SESSIONS_PER_PRINCIPAL; device += 1) {
      await signIn();
    }

    const rows = () => [...harness.sessions.rows.values()];

    expect(rows().filter((row) => row.revokedAt !== null)).toEqual([]);

    // One more of the customer's own: now the cap bites, on the oldest of
    // *their* sessions and on nothing an operator opened.
    await signIn();

    const revoked = rows().filter((row) => row.revokedAt !== null);
    const own = rows().filter((row) => row.impersonatedByStaffId === null);
    const impersonated = rows().filter(
      (row) => row.impersonatedByStaffId !== null,
    );

    expect(revoked).toHaveLength(1);
    expect(revoked[0]?.id).toBe(own[0]?.id);
    expect(impersonated).toHaveLength(MAX_SESSIONS_PER_PRINCIPAL);
    expect(impersonated.every((row) => row.revokedAt === null)).toBe(true);
  });
});
