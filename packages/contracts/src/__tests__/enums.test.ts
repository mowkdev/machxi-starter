import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  INVITATION_STATUSES,
  ORGANIZATION_KINDS,
  ORGANIZATION_OWNER_ROLE,
  ORGANIZATION_ROLES,
  POPULATIONS,
  SORT_DIRECTIONS,
  STAFF_ROLES,
  STAFF_STATUSES,
  SUPER_ADMIN_ROLE,
  TOKEN_PURPOSES,
  USER_ROLES,
  USER_STATUSES,
  type InvitationStatus,
  type OrganizationKind,
  type OrganizationRole,
  type Population,
  type Role,
  type StaffRole,
  type StaffStatus,
  type TokenPurpose,
  type UserRole,
  type UserStatus,
} from "../index.js";

/**
 * The enums are the one place where the database, validation and the UIs must
 * agree (ADR-0023), so these tests pin the values themselves. A change here is
 * a migration (`ALTER TYPE … ADD VALUE`) plus a contracts release, and the
 * failing assertion is the reminder.
 */
describe("enums", () => {
  it("declares the two populations (ADR-0017)", () => {
    expect(POPULATIONS).toEqual(["staff", "user"]);
  });

  it("declares the staff roles and statuses", () => {
    expect(STAFF_ROLES).toEqual(["super_admin", "admin", "manager", "editor"]);
    expect(STAFF_STATUSES).toEqual(["active", "invited", "disabled"]);
  });

  it("declares the user roles and statuses", () => {
    expect(USER_ROLES).toEqual(["customer"]);
    expect(USER_STATUSES).toEqual([
      "active",
      "pending_verification",
      "disabled",
    ]);
  });

  it("names the role that bypasses every staff role check (ADR-0019)", () => {
    expect(SUPER_ADMIN_ROLE).toBe("super_admin");
    expect(STAFF_ROLES).toContain(SUPER_ADMIN_ROLE);
  });

  it("keeps the two populations disjoint in their statuses", () => {
    expect(STAFF_STATUSES).toContain("invited");
    expect(USER_STATUSES).not.toContain("invited");
    expect(USER_STATUSES).toContain("pending_verification");
    expect(STAFF_STATUSES).not.toContain("pending_verification");
  });

  it("has no duplicate members, which Postgres would reject in a pgEnum", () => {
    for (const values of [
      POPULATIONS,
      STAFF_ROLES,
      STAFF_STATUSES,
      USER_ROLES,
      USER_STATUSES,
      SORT_DIRECTIONS,
      ORGANIZATION_KINDS,
      ORGANIZATION_ROLES,
      INVITATION_STATUSES,
      TOKEN_PURPOSES,
    ]) {
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("feeds z.enum directly, which is what module schemas rely on", () => {
    const schema = z.enum(STAFF_ROLES);

    expect(schema.parse("admin")).toBe("admin");
    expect(schema.safeParse("customer").success).toBe(false);

    // The same tuple that becomes `pgEnum("token_purpose", …)` also has to
    // validate a request body (ADR-0023, ADR-0071 §1): one declaration, two
    // consumers, which is the whole reason these live here rather than in
    // `@repo/db`.
    const purposes = z.enum(TOKEN_PURPOSES);

    expect(purposes.parse("verify_email")).toBe("verify_email");
    expect(purposes.safeParse("invitation").success).toBe(false);
  });

  it("declares the organization kinds and membership roles (ADR-0067 §2)", () => {
    expect(ORGANIZATION_KINDS).toEqual(["personal", "team"]);
    expect(ORGANIZATION_ROLES).toEqual(["owner", "admin", "member"]);
  });

  it("names the role an organization must always keep one of (ADR-0067 §2)", () => {
    expect(ORGANIZATION_OWNER_ROLE).toBe("owner");
    expect(ORGANIZATION_ROLES).toContain(ORGANIZATION_OWNER_ROLE);
  });

  it("keeps membership roles apart from the account's own roles (ADR-0067 §2)", () => {
    // A user role is a property of the account; a membership role is a
    // property of one (account, organization) pair. Any overlap here would
    // invite a guard to read one where it meant the other.
    for (const role of ORGANIZATION_ROLES) {
      expect(USER_ROLES).not.toContain(role);
    }
  });

  it("declares the derived invitation statuses, `expired` among them", () => {
    expect(INVITATION_STATUSES).toEqual([
      "pending",
      "accepted",
      "declined",
      "revoked",
      "expired",
    ]);
    // The reason this tuple is not a `pgEnum`: no column can hold `expired`,
    // which becomes true as the clock passes `expires_at` with no row written.
    expect(INVITATION_STATUSES).toContain("expired");
  });

  it("narrows to the invitable roles, which exclude owner (ADR-0067 §2)", () => {
    const invitable = z
      .enum(ORGANIZATION_ROLES)
      .exclude([ORGANIZATION_OWNER_ROLE]);

    expect(invitable.parse("admin")).toBe("admin");
    expect(invitable.parse("member")).toBe("member");
    expect(invitable.safeParse("owner").success).toBe(false);
  });

  it("declares the four token purposes (ADR-0071 §1)", () => {
    expect(TOKEN_PURPOSES).toEqual([
      "verify_email",
      "reset_password",
      "change_email",
      "staff_onboarding",
    ]);
  });

  it("leaves the organization invitation out of the purposes (ADR-0071 §1)", () => {
    // It keeps its own table and its own `token_hash`, because it carries
    // organization state a generic row does not. A purpose named for it would
    // be a second place to look for one row.
    for (const purpose of TOKEN_PURPOSES) {
      expect(purpose).not.toContain("invitation");
    }
  });

  it("derives the unions from the arrays rather than restating them", () => {
    const population: Population = "staff";
    const staffRole: StaffRole = "manager";
    const userRole: UserRole = "customer";
    const staffStatus: StaffStatus = "invited";
    const userStatus: UserStatus = "pending_verification";
    const anyRole: Role = staffRole;
    const organizationKind: OrganizationKind = "personal";
    const organizationRole: OrganizationRole = "owner";
    const invitationStatus: InvitationStatus = "pending";
    const tokenPurpose: TokenPurpose = "verify_email";

    expect([
      population,
      staffRole,
      userRole,
      staffStatus,
      userStatus,
      anyRole,
      organizationKind,
      organizationRole,
      invitationStatus,
      tokenPurpose,
    ]).toHaveLength(10);
  });
});
