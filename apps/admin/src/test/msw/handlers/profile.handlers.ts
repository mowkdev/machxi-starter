import {
  changePasswordBody,
  updateStaffProfileBody,
  type ChangePasswordBody,
  type StaffResource,
  type UpdateStaffProfileBody,
} from "@repo/contracts";
import { http, type HttpHandler } from "msw";

import { API, PRINCIPAL } from "./auth.handlers";
import { fail, ok } from "./envelope";

/**
 * `/api/v1/admin/profile`, as MSW answers it (ADR-0036 §The load-bearing rule).
 *
 * Every request is parsed with the schema the API validates with, so a body
 * this app builds wrongly throws here rather than being quietly accepted by a
 * mock that is kinder than the server.
 *
 * **The two refusals are modelled, and the naming says which service function
 * each one mirrors** — the enforcement D3.8 asked for after two handlers had
 * drifted in the permissive direction. `changePassword` here mirrors
 * `staffService.changePassword`: it verifies the actor's own password *first*
 * (ADR-0027 rule 1, and the order the D2.3 review fixed on the API), and it
 * revokes every session but the caller's — recorded as a count rather than
 * enacted, because a mock has no sessions, and because that count is the only
 * way a test can assert the half of ADR-0027 that is invisible from the
 * response: `204`, no body, and this session still signed in.
 */

/** The signed-in operator, as `GET /admin/profile` returns them. */
export const PROFILE: StaffResource = {
  id: PRINCIPAL.id,
  email: PRINCIPAL.email,
  firstName: "Ada",
  lastName: "Admin",
  status: "active",
  roles: ["super_admin"],
  lastLoginAt: "2026-08-20T08:15:00.000Z",
  createdAt: "2026-01-04T10:00:00.000Z",
  updatedAt: "2026-08-20T08:15:00.000Z",
};

/** The operator's own current password, for the ADR-0027 check. */
export const CURRENT_PASSWORD = "DevPassword!123";

export interface ProfileMockState {
  profile: StaffResource;
  password: string;
  /** Sessions ended by the last successful change — the caller's excluded. */
  otherSessionsRevoked: number;
  readonly seen: {
    updated: UpdateStaffProfileBody[];
    /** Bodies the endpoint **accepted**. A refusal goes in `refused`. */
    changed: ChangePasswordBody[];
    refused: ChangePasswordBody[];
  };
}

export const createProfileMockState = (
  profile: StaffResource = PROFILE,
): ProfileMockState => ({
  profile: { ...profile },
  password: CURRENT_PASSWORD,
  otherSessionsRevoked: 0,
  seen: { updated: [], changed: [], refused: [] },
});

export const createProfileHandlers = (state: ProfileMockState) =>
  [
    http.get(`${API}/profile`, () => ok(state.profile)),

    http.patch(`${API}/profile`, async ({ request }): Promise<Response> => {
      const body = updateStaffProfileBody.parse(await request.json());

      state.seen.updated.push(body);

      /*
       * Key by key rather than `...body`: zod omits an absent optional key, so
       * the wholesale spread is right at runtime and cannot be typed as such
       * under `exactOptionalPropertyTypes` (ADR-0002). The staff handler makes
       * the same call for the same reason.
       */
      state.profile = {
        ...state.profile,
        ...(body.firstName === undefined ? {} : { firstName: body.firstName }),
        ...(body.lastName === undefined ? {} : { lastName: body.lastName }),
        updatedAt: "2026-08-20T12:00:00.000Z",
      };

      return ok(state.profile);
    }),

    http.post(
      `${API}/profile/change-password`,
      async ({ request }): Promise<Response> => {
        const body = changePasswordBody.parse(await request.json());

        // `staffService.changePassword` verifies the actor before it hashes
        // anything; a wrong one is `403 AUTH_CURRENT_PASSWORD_INVALID`, the
        // same code the administrative reset answers (ADR-0027 §Contracts).
        if (body.currentPassword !== state.password) {
          state.seen.refused.push(body);

          return fail(403, "AUTH_CURRENT_PASSWORD_INVALID");
        }

        // Recorded *after* the check, so `seen.changed` means "the endpoint
        // accepted this" rather than "the endpoint saw it" — a refused attempt
        // in that list would let an assertion about what landed pass on a
        // `403` (D3.9 review).
        state.seen.changed.push(body);

        state.password = body.newPassword;
        // `exceptSessionId: principal.sessionId` — the caller's session is the
        // one this endpoint deliberately spares.
        state.otherSessionsRevoked = 2;

        return new Response(null, { status: 204 });
      },
    ),
  ] as const satisfies readonly HttpHandler[];
