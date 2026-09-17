import type { DbExecutor } from "@repo/db";

import type { Audit } from "../../core/audit/index.js";
import type { LimitedHasher } from "../../core/auth/index.js";
import type { MailSender, MailTemplates } from "../../core/mail/index.js";
import type { AccountTokens } from "../../core/tokens/index.js";
import type { AuthService } from "../auth/index.js";
import {
  createStaffController,
  createStaffProfileController,
} from "./staff.controller.js";
import { createStaffRepository } from "./staff.repository.js";
import { createStaffService } from "./staff.service.js";

/** What the composition root hands this module (ADR-0073 §10). */
export interface WireStaffDeps {
  readonly db: DbExecutor;
  /** Hashing with ADR-0020's concurrency cap already applied. */
  readonly hasher: LimitedHasher;
  /**
   * The auth module's session revocation, bound to the `staff` population.
   * Narrowed to the one function this module may call: a module depends on
   * another module's *service*, never its repository (ADR-0009).
   */
  readonly sessions: Pick<AuthService, "revokeSessionsFor">;
  readonly audit: Audit;
  readonly accountTokens: AccountTokens;
  /** ADR-0066 §1's port. Never a mail client a service imports. */
  readonly mail: MailSender;
  /** ADR-0071 §2's messages, built from the two SPA origins at the root. */
  readonly mailTemplates: MailTemplates;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
}

/**
 * The staff module's wiring (ADR-0073 §10).
 *
 * Two controllers over one service: `/api/v1/admin/profile` exposes only the
 * functions that read their subject from `ctx.principal`, so no handler taking
 * an `:id` is reachable from it (ADR-0027).
 */
export const wireStaff = ({
  db,
  hasher,
  sessions,
  audit,
  accountTokens,
  mail,
  mailTemplates,
  transaction,
}: WireStaffDeps) => {
  const repository = createStaffRepository(db);

  const staff = createStaffService({
    repository,
    hasher,
    sessions,
    // The one row this module writes for itself (ADR-0058, ADR-0071 §7), and
    // the token service that flow supersedes a live `change_email` link
    // through (ADR-0071 §1).
    audit,
    accountTokens,
    // ADR-0066 §1's port and ADR-0071 §2's messages, for the flow this module
    // owns end to end but for the consume: a staff member created without a
    // password is `invited` and is mailed an onboarding link (§8). The link
    // lands on the **admin** app, which is why `mailTemplates` is built from
    // both origins at the root.
    mail,
    mailTemplates,
    transaction,
  });

  return {
    repositories: { staff: repository } as const,
    services: { staff } as const,
    controllers: {
      staff: createStaffController(staff),
      staffProfile: createStaffProfileController(staff),
    } as const,
  } as const;
};
