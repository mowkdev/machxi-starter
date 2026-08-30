import {
  MAX_SETTINGS_GRIDS,
  type GridPreferencesV1,
  type StaffSettingsResource,
  type UpdateStaffSettingsBody,
  type UserSettingsResource,
} from "@repo/contracts";
import type { DbExecutor } from "@repo/db";

import { requirePrincipal } from "../../core/auth/index.js";
import type { RequestContext } from "../../core/context/index.js";
import { validation } from "../../core/errors/index.js";
import { settingsDefaults, toSettingsResource } from "./settings.mapper.js";
import type {
  SettingsRepository,
  SettingsWrite,
} from "./settings.repository.js";

/**
 * The settings module's business logic (ADR-0009, ADR-0045).
 *
 * One service for both segments, because the two populations hold the same
 * settings and differ only in which table the row lives in. `tableFor` is the
 * single place a request's population becomes a table, so it cannot be spelled
 * two ways; the two halves share one signature, so nothing below it branches
 * on population again.
 *
 * There is no `settings.errors.ts` and none is expected: a caller reads and
 * writes its own row, so there is no conflict state, no foreign row and no
 * standing question. The one thing that can go wrong is a body the schema
 * cannot refuse on its own, and that is `VALIDATION_ERROR` (ADR-0013).
 */

type SettingsResource = StaffSettingsResource & UserSettingsResource;
type SettingsPatch = UpdateStaffSettingsBody;

export interface SettingsServiceDeps {
  readonly repository: SettingsRepository;
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
}

/**
 * Applies one `grids` patch to what is stored, entry by entry.
 *
 * Pure, and the whole of the merge rule: a key whose value is an object
 * replaces that grid's entry, a key whose value is `null` deletes it, and a
 * key the patch does not mention is untouched. That last clause is the point —
 * it is what lets a client send only what changed and lets two tabs patching
 * different grids both land.
 *
 * Built on a fresh object rather than mutating `current`, so a caller that
 * still holds the row it read is not surprised by it changing underneath.
 */
export const mergeGrids = (
  current: Readonly<Record<string, GridPreferencesV1>>,
  patch: Readonly<Record<string, GridPreferencesV1 | null>> | undefined,
): Record<string, GridPreferencesV1> => {
  const next: Record<string, GridPreferencesV1> = { ...current };

  if (patch === undefined) return next;

  for (const [gridId, entry] of Object.entries(patch)) {
    if (entry === null) {
      delete next[gridId];
    } else {
      next[gridId] = entry;
    }
  }

  return next;
};

/**
 * The whole patch against the whole row. Scalars replace when present; `grids`
 * merges per key. Pure, so the transaction below has nothing in it but the
 * lock, this call and the write.
 */
export const applyPatch = (
  current: SettingsResource,
  patch: SettingsPatch,
): SettingsWrite => ({
  theme: patch.theme ?? current.theme,
  locale: patch.locale ?? current.locale,
  gridDensity: patch.gridDensity ?? current.gridDensity,
  grids: mergeGrids(current.grids, patch.grids),
});

export const createSettingsService = ({
  repository,
  transaction,
}: SettingsServiceDeps) => {
  /**
   * The only place a population becomes a table.
   *
   * The id comes from `ctx.principal`, which `authenticate` set from a
   * verified session — never from anything a request supplies. An `admin`
   * cannot read a colleague's settings because there is no parameter through
   * which to name one, and the two segments cannot reach each other's rows
   * because they select different halves of this repository (ADR-0045
   * §Security).
   */
  const tableFor = (ctx: RequestContext) => {
    const principal = requirePrincipal(ctx);

    return { table: repository[principal.kind], principalId: principal.id };
  };

  /**
   * The bound a body cannot check: forty stored keys plus twenty new ones is
   * a valid patch and an invalid row, so the count is taken on the **merged**
   * result, inside the transaction that is about to write it.
   */
  const assertGridCount = (grids: Record<string, GridPreferencesV1>): void => {
    const count = Object.keys(grids).length;

    if (count > MAX_SETTINGS_GRIDS) {
      throw validation("Request validation failed", [
        {
          path: "grids",
          message: `At most ${String(MAX_SETTINGS_GRIDS)} grids may be stored; this patch would leave ${String(count)}`,
          code: "too_big",
        },
      ]);
    }
  };

  return {
    /**
     * `GET /settings`. Never `404`: a principal who has never written one has
     * the defaults, which is the same answer a row holding them would give.
     */
    get: async (ctx: RequestContext): Promise<SettingsResource> => {
      const { table, principalId } = tableFor(ctx);

      return toSettingsResource(await table.findByPrincipal(principalId));
    },

    /**
     * `PATCH /settings` — merge, bound, write, and answer with what the
     * server now holds.
     *
     * The whole of it runs against the **locked** row rather than against
     * whatever the client last read, which is what makes the per-key merge
     * mean anything under concurrency: two tabs patching different grids
     * serialise on the row and both land, and two patching the same grid
     * serialise and the later one wins for that key — the last-write-wins
     * ADR-0041 already accepted for two tabs, now across devices.
     */
    update: (
      ctx: RequestContext,
      patch: SettingsPatch,
    ): Promise<SettingsResource> =>
      transaction(async (tx) => {
        const { table, principalId } = tableFor(ctx);
        const current = await table.lockForUpdate(principalId, tx);
        const next = applyPatch(current, patch);

        assertGridCount(next.grids);

        return toSettingsResource(await table.save(principalId, next, tx));
      }),
  } as const;
};

export type SettingsService = ReturnType<typeof createSettingsService>;

export { settingsDefaults };
