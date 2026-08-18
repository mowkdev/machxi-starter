import type { Population, PrincipalResource, Role } from "@repo/contracts";
import type { DbExecutor } from "@repo/db";

/**
 * The seam that lets one auth service serve both populations (ADR-0017).
 *
 * `createAuthService` is written once and instantiated twice — once with the
 * staff adapter, once with the user adapter. Everything that differs between
 * `staff` and `users` (which table, which status counts as active, whether the
 * password hash may be null, what the wire resource looks like) is decided
 * behind this interface, so the login, refresh, rotation and revocation logic
 * exists in exactly one place.
 */

/**
 * A principal as the auth service needs it, whichever table it came from.
 *
 * `resource` is the already-mapped wire form rather than raw name columns: the
 * two populations type their names differently (ADR-0017), and building the
 * resource inside the adapter is what lets this interface stay flat without
 * either erasing that difference or making the service generic over it.
 *
 * `active` is a boolean rather than the raw `status`, for the same reason
 * ADR-0017 gives the adapter an `isActive`: which enum values count as active
 * is the population's business, and the status value itself never needs to
 * leave the repository layer.
 */
export interface PrincipalRecord {
  readonly id: string;
  readonly email: string;
  /** `null` for an account with no password login (users only, ADR-0017). */
  readonly passwordHash: string | null;
  readonly active: boolean;
  readonly roles: readonly Role[];
  readonly resource: PrincipalResource;
}

/** What registration inserts. Only the user adapter implements it. */
export interface CreatePrincipalInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
}

export interface PrincipalAdapter<P extends Population = Population> {
  readonly population: P;
  findByEmail: (
    email: string,
    tx?: DbExecutor,
  ) => Promise<PrincipalRecord | undefined>;
  findById: (
    id: string,
    tx?: DbExecutor,
  ) => Promise<PrincipalRecord | undefined>;
  /** ADR-0018 login step 5. */
  touchLastLogin: (id: string, at: Date, tx?: DbExecutor) => Promise<void>;
  /** Transparent argon2 parameter upgrade on a successful login. */
  updatePasswordHash: (
    id: string,
    passwordHash: string,
    at: Date,
    tx?: DbExecutor,
  ) => Promise<void>;
  /**
   * Self-registration, and therefore **absent on the staff adapter**: staff
   * are created by an admin, never by themselves (ADR-0017 §Invariants). The
   * public register route is mounted from the user service only; the service
   * refuses rather than assuming, because "this population cannot self
   * register" is a rule, not a missing feature.
   *
   * Resolves to `undefined` when the email is already taken.
   */
  create?: (
    input: CreatePrincipalInput,
    tx?: DbExecutor,
  ) => Promise<PrincipalRecord | undefined>;
}
