import {
  updateStaffSettingsBody,
  updateUserSettingsBody,
} from "@repo/contracts";

/**
 * The route schemas of the settings module (ADR-0011).
 *
 * Re-exported from `@repo/contracts` rather than declared here (ADR-0023):
 * the admin panel writes these bodies from the same objects the server
 * validates them with, so a grid entry the server would refuse is one the
 * client never sends.
 *
 * There is no `params` schema and there never will be one. The subject of
 * every route here is `ctx.principal`, so there is no id for a caller to
 * tamper with — the ownership question ADR-0019 §3 asks has no way to be
 * answered wrongly (ADR-0045 §Endpoints).
 */

/**
 * `PATCH /settings`, one entry per population.
 *
 * Two names for one shape today, keyed by population so the router picks its
 * own rather than sharing a single schema that would have to be split — and
 * renamed at every call site — the day the two bodies diverge.
 */
export const updateSettingsSchemas = {
  staff: { body: updateStaffSettingsBody },
  user: { body: updateUserSettingsBody },
} as const;

/**
 * What the controller types `req.valid` against. The staff entry stands for
 * both while they are identical; when they diverge, the controller splits
 * with them and this alias is where that shows up first.
 */
export type UpdateSettingsSchema = (typeof updateSettingsSchemas)["staff"];
