import {
  changePasswordBody,
  updateProfileBody,
  type ChangePasswordBody,
  type UpdateProfileBody,
  type UserResource,
} from "@repo/contracts";
import { http, type HttpHandler } from "msw";

import { API, PRINCIPAL } from "./auth.handlers";
import { fail, ok } from "./envelope";

/**
 * `/api/v1/user/profile`, as MSW answers it (ADR-0036 §The load-bearing rule).
 *
 * Every request is parsed with the schema the API validates with, so a body
 * this app builds wrongly throws here rather than being quietly accepted by a
 * mock that is kinder than the server.
 *
 * **The refusals are modelled, and the naming says which service function each
 * one mirrors.** `changePassword` here mirrors the user module's: it verifies
 * the actor's own password *first* (ADR-0027 rule 1, and the order the D2.3
 * review fixed on the API), and it revokes every session but the caller's —
 * recorded as a count rather than enacted, because a mock has no sessions, and
 * because that count is the only way a test can assert the half of ADR-0027
 * that is invisible from the response: `204`, no body, and this session still
 * signed in.
 *
 * **The base URL is `/api/v1/user` and that is the whole point of the app.** A
 * handler mounted on the wrong segment would answer requests this app never
 * makes and let the real ones fall through to `onUnhandledRequest: "error"`.
 *
 * `DELETE /profile` is deliberately absent: it is `D12.8`'s, and a mock for an
 * endpoint no screen calls would be a permission this suite has not earned.
 */

/** The signed-in customer, as `GET /user/profile` returns them. */
export const PROFILE: UserResource = {
  id: PRINCIPAL.id,
  email: PRINCIPAL.email,
  firstName: PRINCIPAL.firstName,
  lastName: PRINCIPAL.lastName,
  status: "active",
  roles: ["customer"],
  lastLoginAt: "2026-08-30T08:15:00.000Z",
  createdAt: "2026-02-11T10:00:00.000Z",
  updatedAt: "2026-08-30T08:15:00.000Z",
  /*
   * Always `null` on this endpoint, and the contract says why: the self view
   * refuses a deleted account outright, so a customer who can read this row is
   * by construction a live one (ADR-0017, `UserResource`).
   */
  deletedAt: null,
};

/** The customer's own current password, for the ADR-0027 check. */
export const CURRENT_PASSWORD = "DevPassword!123";

export interface ProfileMockState {
  profile: UserResource;
  password: string;
  /** Sessions ended by the last successful change — the caller's excluded. */
  otherSessionsRevoked: number;
  readonly seen: {
    updated: UpdateProfileBody[];
    /** Bodies the endpoint **accepted**. A refusal goes in `refused`. */
    changed: ChangePasswordBody[];
    refused: ChangePasswordBody[];
  };
}

export const createProfileMockState = (
  profile: UserResource = PROFILE,
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
      const body = updateProfileBody.parse(await request.json());

      state.seen.updated.push(body);

      /*
       * Key by key rather than `...body`: zod omits an absent optional key, so
       * the wholesale spread is right at runtime and cannot be typed as such
       * under `exactOptionalPropertyTypes` (ADR-0002).
       */
      state.profile = {
        ...state.profile,
        ...(body.firstName === undefined ? {} : { firstName: body.firstName }),
        ...(body.lastName === undefined ? {} : { lastName: body.lastName }),
        updatedAt: "2026-08-31T12:00:00.000Z",
      };

      return ok(state.profile);
    }),

    http.post(
      `${API}/profile/change-password`,
      async ({ request }): Promise<Response> => {
        const body = changePasswordBody.parse(await request.json());

        // The service verifies the actor before it hashes anything; a wrong one
        // is `403 AUTH_CURRENT_PASSWORD_INVALID` (ADR-0027 §Contracts).
        if (body.currentPassword !== state.password) {
          state.seen.refused.push(body);

          return fail(403, "AUTH_CURRENT_PASSWORD_INVALID");
        }

        // Recorded *after* the check, so `seen.changed` means "the endpoint
        // accepted this" rather than "the endpoint saw it" — a refused attempt
        // in that list would let an assertion about what landed pass on a 403.
        state.seen.changed.push(body);

        state.password = body.newPassword;
        // `exceptSessionId: principal.sessionId` — the caller's session is the
        // one this endpoint deliberately spares.
        state.otherSessionsRevoked = 2;

        return new Response(null, { status: 204 });
      },
    ),
  ] as const satisfies readonly HttpHandler[];
