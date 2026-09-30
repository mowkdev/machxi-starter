import type { DbExecutor } from "@repo/db";

import type { AppConfig } from "../../core/config/index.js";
import type { MailSender, MailTemplates } from "../../core/mail/index.js";
import { createInvitationsRepository } from "./invitations.repository.js";
import { createMembershipsRepository } from "./memberships.repository.js";
import {
  createOrganizationsController,
  createPublicInvitationsController,
  createUserInvitationsController,
  createUserOrganizationsController,
} from "./organizations.controller.js";
import { createOrganizationsRepository } from "./organizations.repository.js";
import { createOrganizationsService } from "./organizations.service.js";

/** What the composition root hands this module (ADR-0073 §10). */
export interface WireOrganizationsDeps {
  readonly config: AppConfig;
  readonly db: DbExecutor;
  /** ADR-0066 §1's port. Never a mail client a service imports. */
  readonly mail: MailSender;
  /** ADR-0071 §2's messages, built from the two SPA origins at the root. */
  readonly mailTemplates: MailTemplates;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
}

/**
 * The organizations module's wiring (ADR-0073 §10).
 *
 * Built before the auth and users modules at the root, because both depend on
 * this service and it depends on neither: it owns the personal organization's
 * lifecycle, and every path that creates or deletes a user runs it inside that
 * path's own transaction (ADR-0067 §2, ADR-0009's service-to-service edge).
 */
export const wireOrganizations = ({
  config,
  db,
  mail,
  mailTemplates,
  transaction,
}: WireOrganizationsDeps) => {
  const repository = createOrganizationsRepository(db);
  // Both tenant-owned repositories borrow the transaction helper, so a read
  // outside a caller's transaction opens one in the request's scope rather
  // than running on the bare pool (ADR-0078 §4 as amended at `D29.4`).
  const memberships = createMembershipsRepository(db, transaction);
  const invitations = createInvitationsRepository(db, transaction);

  const organizations = createOrganizationsService({
    repository,
    memberships,
    invitations,
    // `ORGANIZATION_INVITATION_TTL` (ADR-0004), threaded rather than read: a
    // service reads no environment (ADR-0004's one-place rule).
    invitationTtlSec: config.organizations.invitationTtlSec,
    transaction,
    // ADR-0066 §1's port and ADR-0071 §2's messages, the same two instances
    // the auth services take: §2's marked call is a real send from `D18.7` on.
    mail,
    mailTemplates,
  });

  return {
    repositories: {
      organizations: repository,
      memberships,
      invitations,
    } as const,
    services: { organizations } as const,
    /*
     * **Four** controllers over one service, one per mount (ADR-0067 §3, §4)
     * — the users module's pairing taken further, and for its reason: a
     * factory can only expose what its segment is allowed to reach.
     * `createForOwner` names an owner by id and exists only on the admin
     * controller; the invitee's accept and decline exist only on the
     * self-scoped one; and neither of those two can reach a handler that takes
     * an organization from the URL. The public one is the only mount outside
     * every guard: the holder of an invitation link has no account yet
     * (ADR-0071 §5).
     */
    controllers: {
      organizations: createOrganizationsController(organizations),
      userOrganizations: createUserOrganizationsController(organizations),
      userInvitations: createUserInvitationsController(organizations),
      publicInvitations: createPublicInvitationsController(organizations),
    } as const,
  } as const;
};
