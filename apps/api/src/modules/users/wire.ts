import type { DbExecutor } from "@repo/db";

import type { Audit } from "../../core/audit/index.js";
import type { LimitedHasher } from "../../core/auth/index.js";
import type { MailSender, MailTemplates } from "../../core/mail/index.js";
import type { AccountTokens } from "../../core/tokens/index.js";
import type { AuthCookies, AuthService } from "../auth/index.js";
import type { OrganizationsService } from "../organizations/index.js";
import type { SettingsService } from "../settings/index.js";
import type { StaffService } from "../staff/index.js";
import {
  createUserProfileController,
  createUsersController,
} from "./users.controller.js";
import { createUsersRepository } from "./users.repository.js";
import { createUsersService } from "./users.service.js";

/** What the composition root hands this module (ADR-0073 §10). */
export interface WireUsersDeps {
  readonly db: DbExecutor;
  /** Hashing with ADR-0020's concurrency cap already applied. */
  readonly hasher: LimitedHasher;
  /**
   * The auth module's session revocation, bound to the `user` population.
   * Narrowed to the one function this module may call (ADR-0009).
   */
  readonly sessions: Pick<AuthService, "revokeSessionsFor">;
  /**
   * The staff service, narrowed to the one question this module cannot answer
   * about itself: on `POST /admin/users/:id/password` the *actor* is a staff
   * member re-presenting their own password (ADR-0027 rule 1).
   */
  readonly actors: Pick<StaffService, "verifyActorPassword">;
  /**
   * The three writes ADR-0067 §2 requires to be transactional with the account
   * they are about: `POST /admin/users` creates the personal organization, and
   * both deletion paths soft-delete it.
   */
  readonly organizations: Pick<
    OrganizationsService,
    "ensurePersonalOrganizationFor" | "deletePersonalOrganizationFor"
  >;
  /**
   * The account's own language, for the one message this module sends
   * (ADR-0071 §2, §6): a locale is an account fact, and which of the two
   * settings tables holds it is the settings service's business.
   */
  readonly locales: Pick<SettingsService, "get">;
  readonly accountTokens: AccountTokens;
  readonly audit: Audit;
  /** ADR-0066 §1's port. Never a mail client a service imports. */
  readonly mail: MailSender;
  /** ADR-0071 §2's messages, built from the two SPA origins at the root. */
  readonly mailTemplates: MailTemplates;
  /** The cookie writer the profile's delete clears the session with. */
  readonly cookies: AuthCookies;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
}

/**
 * The users module's wiring (ADR-0073 §10).
 *
 * One service behind two controllers: `/api/v1/user/profile` exposes only the
 * functions that read their subject from `ctx.principal`, so the admin
 * handlers are not reachable from the user segment even by a routing mistake
 * (ADR-0019).
 */
export const wireUsers = ({
  db,
  hasher,
  sessions,
  actors,
  organizations,
  locales,
  accountTokens,
  audit,
  mail,
  mailTemplates,
  cookies,
  transaction,
}: WireUsersDeps) => {
  const repository = createUsersRepository(db);

  const users = createUsersService({
    repository,
    hasher,
    sessions,
    locales,
    // ADR-0071 §1's mint and ADR-0066 §1's port: `change-email` mails a
    // confirmation link to an address nobody has proven yet, and the address
    // waits in the token's payload until somebody does (§6). The *consume* is
    // the auth module's, because the link is followed without a session.
    accountTokens,
    mail,
    mailTemplates,
    // `account.email_changed` for the administrative half of the flow
    // (ADR-0071 §7): the actor is the super admin on the context and the
    // subject rides in the row's data.
    audit,
    actors,
    organizations,
    transaction,
  });

  return {
    repositories: { users: repository } as const,
    services: { users } as const,
    controllers: {
      users: createUsersController(users),
      userProfile: createUserProfileController({ service: users, cookies }),
    } as const,
  } as const;
};
