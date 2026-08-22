import {
  DEFAULT_LOCALE,
  DEFAULT_THEME,
  MAX_SETTINGS_GRIDS,
  updateStaffSettingsBody,
  type ErrorCode,
  type GridPreferencesV1,
  type StaffSettingsResource,
  type UpdateStaffSettingsBody,
} from "@repo/contracts";
import { http, type HttpHandler } from "msw";

import { API } from "./auth.handlers";
import { fail, ok } from "./envelope";

/**
 * `/api/v1/admin/settings`, as MSW answers it (ADR-0036 §The load-bearing
 * rule, ADR-0045 §Endpoints).
 *
 * The `PATCH` is parsed with `updateStaffSettingsBody` — the schema the API
 * validates with — so a body this app builds wrongly throws here instead of
 * being quietly accepted by a mock that is kinder than the server. And the
 * merge is modelled rather than assumed: this handler mirrors
 * `settingsService.update`, which replaces `theme` and `locale`, applies
 * `grids` **entry by entry**, deletes on `null`, and refuses a merged row over
 * {@link MAX_SETTINGS_GRIDS}. A mock that replaced the document instead would
 * let the coalescing writer's whole reason for existing pass untested.
 *
 * `GET` never answers `404`: a principal with no row has the defaults, and the
 * client is never asked to tell that from "your settings are the defaults".
 */

export const DEFAULT_SETTINGS: StaffSettingsResource = {
  theme: DEFAULT_THEME,
  locale: DEFAULT_LOCALE,
  grids: {},
};

export interface SettingsMockState {
  settings: StaffSettingsResource;
  readonly seen: {
    /** Every body the endpoint **accepted**, in order — the coalescing witness. */
    patches: UpdateStaffSettingsBody[];
    /** How many times `GET /settings` was asked. Zero, signed out. */
    reads: number;
  };
  /** When set, both verbs answer this instead of succeeding. */
  failWith?: { status: number; code: ErrorCode } | undefined;
}

export const createSettingsMockState = (
  settings: StaffSettingsResource = DEFAULT_SETTINGS,
): SettingsMockState => ({
  settings: { ...settings, grids: { ...settings.grids } },
  seen: { patches: [], reads: 0 },
});

/** `settingsService`'s per-key merge, which is the half a `PUT` could not do. */
const mergeGrids = (
  current: Readonly<Record<string, GridPreferencesV1>>,
  patch: NonNullable<UpdateStaffSettingsBody["grids"]>,
): Record<string, GridPreferencesV1> => {
  const merged: Record<string, GridPreferencesV1> = { ...current };

  for (const [gridId, entry] of Object.entries(patch)) {
    if (entry === null) delete merged[gridId];
    else merged[gridId] = entry;
  }

  return merged;
};

export const createSettingsHandlers = (state: SettingsMockState) =>
  [
    http.get(`${API}/settings`, (): Response => {
      state.seen.reads += 1;

      if (state.failWith) {
        return fail(state.failWith.status, state.failWith.code);
      }

      return ok(state.settings);
    }),

    http.patch(`${API}/settings`, async ({ request }): Promise<Response> => {
      const body = updateStaffSettingsBody.parse(await request.json());

      if (state.failWith) {
        return fail(state.failWith.status, state.failWith.code);
      }

      const grids =
        body.grids === undefined
          ? state.settings.grids
          : mergeGrids(state.settings.grids, body.grids);

      // The bound a body cannot check: forty existing keys plus twenty new
      // ones is a valid body and an invalid row (ADR-0045 §Endpoints).
      if (Object.keys(grids).length > MAX_SETTINGS_GRIDS) {
        return fail(422, "VALIDATION_ERROR", "Too many grids", [
          { path: "grids", message: "Too many grids" },
        ]);
      }

      // Recorded after the refusals, so `seen.patches` means "the endpoint
      // accepted this" rather than "the endpoint saw it".
      state.seen.patches.push(body);

      state.settings = {
        ...state.settings,
        ...(body.theme === undefined ? {} : { theme: body.theme }),
        ...(body.locale === undefined ? {} : { locale: body.locale }),
        grids,
      };

      return ok(state.settings);
    }),
  ] as const satisfies readonly HttpHandler[];
