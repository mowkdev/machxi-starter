/**
 * Constants shared by the `--dev` fixture seeders (ADR-0008).
 *
 * These accounts exist so the Postman collection (ADR-0021) can run
 * top-to-bottom without anyone inventing credentials, and so the role guards
 * (ADR-0019) can be exercised by logging in as somebody who is *not* a super
 * admin. `--dev` refuses to run when `NODE_ENV=production`, which is what
 * makes a password in a committed file acceptable.
 */

/**
 * One password for every fixture account. Long enough for the ADR-0018 policy
 * (min 12 characters) so these accounts can also change their own password
 * without tripping validation.
 */
export const DEV_PASSWORD = "DevPassword!123";

/** `.local` is reserved by RFC 6762 and cannot be registered, so no fixture address can reach a real inbox. */
export const DEV_STAFF = [
  {
    email: "manager@machxi.local",
    firstName: "Mia",
    lastName: "Manager",
    role: "manager",
  },
  {
    email: "editor@machxi.local",
    firstName: "Eli",
    lastName: "Editor",
    role: "editor",
  },
] as const;

export const DEV_USERS = [
  {
    email: "customer@machxi.local",
    firstName: "Cleo",
    lastName: "Customer",
    status: "active",
  },
  {
    email: "pending@machxi.local",
    firstName: "Pat",
    lastName: "Pending",
    status: "pending_verification",
  },
  {
    // Disabled on purpose: the login flow must answer AUTH_ACCOUNT_DISABLED
    // (403) rather than AUTH_INVALID_CREDENTIALS, and that path needs a
    // fixture to test against (ADR-0021).
    email: "disabled@machxi.local",
    firstName: "Dana",
    lastName: "Disabled",
    status: "disabled",
  },
] as const;

/**
 * The one `team` organization the fixtures create (ADR-0067 §2).
 *
 * A known slug, because the Postman collection addresses it by name and a
 * generated one would have to be discovered by a request that exists only to
 * find it. Owned by the first `--dev` customer, who is also the account
 * Postman signs in as, so the collection can run the owner-only paths
 * top-to-bottom without inventing a membership.
 */
export const DEV_TEAM_ORGANIZATION = {
  slug: "acme",
  name: "Acme Inc.",
  ownerEmail: DEV_USERS[0].email,
} as const;
