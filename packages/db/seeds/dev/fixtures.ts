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
  /**
   * A pending invitation addressed to the second `--dev` customer, so the
   * invitee's own surface — `GET /user/invitations`, accept, decline — has
   * something to run against on a fresh clone (ADR-0067 §2).
   *
   * The **token is minted per run and never written here.** A literal hash in
   * a committed fixture would be one shared credential across every clone of
   * this repository the day the mail deliverable makes the token acceptable,
   * and a fixture is exactly where such a thing goes unnoticed. The seeder
   * mints `sha256Base64url(randomToken())` instead, so the row is shaped like
   * a real one and its secret exists nowhere.
   */
  invitee: DEV_USERS[1].email,
  inviteeRole: "member",
} as const;

/**
 * The one federated identity the fixtures carry (ADR-0072 §1): a Google link
 * on the first `--dev` customer, so the profile's list of ways in, and the
 * unlink paths, have a row to answer about on a fresh clone without anybody
 * signing in through Google.
 *
 * **The subject is synthetic and cannot be anybody's.** Google's `sub` is a
 * decimal string; this one is not, so no real Google account can present an
 * ID token that resolves to it — which matters, because resolution is by
 * subject first and a fixture subject that collided with a real one would
 * sign that stranger into `customer@machxi.local` on any clone configured
 * with real credentials. The account keeps its password, so the fixture is
 * the "both ways in" shape rather than the passwordless one.
 */
export const DEV_FEDERATED_IDENTITY = {
  userEmail: DEV_USERS[0].email,
  provider: "google",
  subject: "dev-fixture-google-subject-customer",
  email: DEV_USERS[0].email,
} as const;
