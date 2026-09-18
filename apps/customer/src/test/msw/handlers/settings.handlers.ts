import {
  DEFAULT_GRID_DENSITY,
  DEFAULT_LOCALE,
  DEFAULT_THEME,
  updateUserSettingsBody,
  type ErrorCode,
  type UpdateUserSettingsBody,
  type UserSettingsResource,
} from "@repo/contracts";
import { http, type HttpHandler } from "msw";

import { API } from "./auth.handlers";
import { fail, ok } from "@repo/app-kit/testing";

/**
 * `/api/v1/user/settings`, as MSW answers it (`D12.7`; ADR-0036 §The
 * load-bearing rule, ADR-0045 §Endpoints).
 *
 * The `PATCH` is parsed with `updateUserSettingsBody` — the schema the API
 * validates with — so a body this app builds wrongly throws here instead of
 * being quietly accepted by a mock that is kinder than the server. The merge is
 * modelled rather than assumed: this mirrors `settingsService.update`, which
 * replaces each scalar it is given and leaves the rest untouched. A mock that
 * replaced the document instead would let the coalescing writer's whole reason
 * for existing pass untested.
 *
 * `GET` never answers `404`: a principal with no row has the defaults, and the
 * client is never asked to tell that from "your settings are the defaults".
 *
 * **`grids` is refused rather than merged, and the refusal is the point.** The
 * segment's schema carries the key — one schema serves both populations — but
 * ADR-0055 §3 keeps `@repo/grid` out of this app until a domain entity arrives,
 * so nothing here can build an arrangement to send. Modelling the per-key merge
 * would be a branch with no caller; throwing turns the day one appears into a
 * loud failure in the suite that has to be looked at, beside the ADR sentence
 * that has to move with it. This is the one way the mock is *narrower* than the
 * endpoint, and it is narrower about this app rather than about the API.
 */

export const DEFAULT_SETTINGS: UserSettingsResource = {
  theme: DEFAULT_THEME,
  locale: DEFAULT_LOCALE,
  gridDensity: DEFAULT_GRID_DENSITY,
  grids: {},
};

export interface SettingsMockState {
  settings: UserSettingsResource;
  readonly seen: {
    /** Every body the endpoint **accepted**, in order — the coalescing witness. */
    patches: UpdateUserSettingsBody[];
    /** How many times `GET /settings` was asked. Zero, signed out. */
    reads: number;
  };
  /** When set, both verbs answer this instead of succeeding. */
  failWith?: { status: number; code: ErrorCode } | undefined;
}

export const createSettingsMockState = (
  settings: UserSettingsResource = DEFAULT_SETTINGS,
): SettingsMockState => ({
  settings: { ...settings, grids: { ...settings.grids } },
  seen: { patches: [], reads: 0 },
});

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
      const body = updateUserSettingsBody.parse(await request.json());

      if (body.grids !== undefined) {
        throw new Error(
          "apps/customer sent `grids`, which ADR-0055 §3 says it has no way to build",
        );
      }

      if (state.failWith) {
        return fail(state.failWith.status, state.failWith.code);
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
      };

      return ok(state.settings);
    }),
  ] as const satisfies readonly HttpHandler[];
