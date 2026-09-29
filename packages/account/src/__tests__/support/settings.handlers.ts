import type { ApiSegment } from "@repo/api-client";
import {
  DEFAULT_GRID_DENSITY,
  DEFAULT_LOCALE,
  DEFAULT_THEME,
  MAX_SETTINGS_GRIDS,
  updateStaffSettingsBody,
  type ErrorCode,
  type GridPreferencesV1,
} from "@repo/contracts";
import { http, type HttpHandler } from "msw";

import type {
  AccountSettings,
  AccountSettingsPatch,
} from "../../settings/settings.types";

import { apiBase, fail, ok } from "./render";

/**
 * `/api/v1/<segment>/settings`, as MSW answers it for this package's suite
 * (`D22.2`, ADR-0077 §4; ADR-0036 §The load-bearing rule, ADR-0045
 * §Endpoints).
 *
 * The `PATCH` is parsed with the schema the API validates with, so a body the
 * writer builds wrongly throws here instead of being quietly accepted by a
 * mock that is kinder than the server. The two populations' bodies are one
 * shape today (`settings.types.ts`), so one schema speaks for either segment.
 *
 * The merge is modelled rather than assumed: this mirrors
 * `settingsService.update`, which replaces the three scalars, applies `grids`
 * **entry by entry**, deletes on `null`, and refuses a merged row over
 * {@link MAX_SETTINGS_GRIDS}. A mock that replaced the document instead would
 * let the coalescing writer's whole reason for existing pass untested.
 *
 * `GET` never answers `404`: a principal with no row has the defaults, and the
 * client is never asked to tell that from "your settings are the defaults".
 */

export const DEFAULT_SETTINGS: AccountSettings = {
  theme: DEFAULT_THEME,
  locale: DEFAULT_LOCALE,
  gridDensity: DEFAULT_GRID_DENSITY,
  grids: {},
};

export interface SettingsMockState {
  settings: AccountSettings;
  readonly seen: {
    /** Every body the endpoint **accepted**, in order — the coalescing witness. */
    patches: AccountSettingsPatch[];
    /** Every body the endpoint was sent and refused, in order. */
    refused: AccountSettingsPatch[];
    /** How many times `GET /settings` was asked. Zero, signed out. */
    reads: number;
  };
  /** When set, both verbs answer this instead of succeeding. */
  failWith?: { status: number; code: ErrorCode } | undefined;
}

export const createSettingsMockState = (
  settings: AccountSettings = DEFAULT_SETTINGS,
): SettingsMockState => ({
  settings: { ...settings, grids: { ...settings.grids } },
  seen: { patches: [], refused: [], reads: 0 },
});

/** `settingsService`'s per-key merge, which is the half a `PUT` could not do. */
const mergeGrids = (
  current: Readonly<Record<string, GridPreferencesV1>>,
  patch: NonNullable<AccountSettingsPatch["grids"]>,
): Record<string, GridPreferencesV1> => {
  const merged: Record<string, GridPreferencesV1> = { ...current };

  for (const [gridId, entry] of Object.entries(patch)) {
    if (entry === null) delete merged[gridId];
    else merged[gridId] = entry;
  }

  return merged;
};

export const createSettingsHandlers = (
  state: SettingsMockState,
  segment: ApiSegment = "user",
) =>
  [
    http.get(`${apiBase(segment)}/settings`, (): Response => {
      state.seen.reads += 1;

      if (state.failWith) {
        return fail(state.failWith.status, state.failWith.code);
      }

      return ok(state.settings);
    }),

    http.patch(
      `${apiBase(segment)}/settings`,
      async ({ request }): Promise<Response> => {
        const body = updateStaffSettingsBody.parse(await request.json());

        if (state.failWith) {
          state.seen.refused.push(body);

          return fail(state.failWith.status, state.failWith.code);
        }

        const grids =
          body.grids === undefined
            ? state.settings.grids
            : mergeGrids(state.settings.grids, body.grids);

        // The bound a body cannot check: forty existing keys plus twenty new
        // ones is a valid body and an invalid row (ADR-0045 §Endpoints).
        if (Object.keys(grids).length > MAX_SETTINGS_GRIDS) {
          state.seen.refused.push(body);

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
          ...(body.gridDensity === undefined
            ? {}
            : { gridDensity: body.gridDensity }),
          grids,
        };

        return ok(state.settings);
      },
    ),
  ] as const satisfies readonly HttpHandler[];
