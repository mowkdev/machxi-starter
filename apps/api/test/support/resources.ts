import {
  STAFF_ROLES,
  STAFF_STATUSES,
  USER_ROLES,
  USER_STATUSES,
} from "@repo/contracts";
import { expect } from "vitest";
import { z } from "zod";

/**
 * Runtime shapes of the two resources step 9 puts on the wire (ADR-0012).
 *
 * `strictObject`, unlike the envelope schemas in `@repo/contracts`, and that is
 * the entire point: what these assert is not "the fields I want are present"
 * but "nothing else is". `StaffRecord` and `UserRecord` both carry
 * `passwordHash`, and `UserRecord` carries the soft-delete marker; the mappers
 * are the only thing keeping those off a response, so a leak has to fail a
 * test rather than merely be unlikely.
 */

const timestamps = {
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
} as const;

export const staffResourceSchema = z.strictObject({
  id: z.uuid(),
  email: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  status: z.enum(STAFF_STATUSES),
  roles: z.array(z.enum(STAFF_ROLES)).min(1),
  ...timestamps,
});

export const userResourceSchema = z.strictObject({
  id: z.uuid(),
  email: z.string().min(1),
  // Nullable, unlike staff: the `users` columns are (ADR-0017).
  firstName: z.string().min(1).nullable(),
  lastName: z.string().min(1).nullable(),
  status: z.enum(USER_STATUSES),
  roles: z.array(z.enum(USER_ROLES)),
  ...timestamps,
});

/**
 * Fails on anything that looks like a credential anywhere in a response body,
 * at any depth — the field name and the argon2 digest prefix both.
 *
 * The strict schemas above already forbid an extra field on a resource; this
 * catches the same leak somewhere the schemas do not look, such as an error's
 * `details` or a future `meta` entry.
 */
export const expectNoSecrets = (body: unknown): void => {
  expect(JSON.stringify(body)).not.toMatch(/\$argon2|passwordHash/);
};
