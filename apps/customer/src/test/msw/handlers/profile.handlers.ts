import {
  changeEmailBody,
  changePasswordBody,
  deleteProfileBody,
  updateProfileBody,
  type ChangeEmailBody,
  type ChangePasswordBody,
  type DeleteProfileBody,
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
 * **`DELETE /profile` arrived at `D12.8`** and is modelled to be no more
 * permissive than the endpoint D12.4 shipped: the body is parsed with
 * `deleteProfileBody`, a deleted account is `404` before anything else is
 * considered (the self view filters `deleted_at`, so every `/user/profile`
 * endpoint answers that way), the current password is verified before any
 * state changes, and success revokes **every** session including the caller's
 * — which is the one line that separates it from `change-password` above.
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
  // Nothing linked: the password-only account (ADR-0072 §3).
  identities: [],
};

/** The customer's own current password, for the ADR-0027 check. */
export const CURRENT_PASSWORD = "DevPassword!123";

export interface ProfileMockState {
  profile: UserResource;
  password: string;
  /** Sessions ended by the last successful change — the caller's excluded. */
  otherSessionsRevoked: number;
  /**
   * Whether the deletion swept **every** session, this one included (`D12.8`).
   *
   * A flag rather than a count, and separate from `otherSessionsRevoked`
   * rather than added to it: what a test has to be able to see here is not how
   * many rows went but that the caller's own was among them, which is the
   * entire difference between ADR-0027's change and ADR-0028's deletion. A
   * mock has no sessions, so the fact is recorded rather than enacted.
   */
  allSessionsRevoked: boolean;
  /**
   * Addresses a live account already holds, so `change-email` can answer
   * `409 USER_EMAIL_TAKEN` (ADR-0071 §6).
   *
   * A list rather than a second profile, because what the client has to get
   * right is the refusal and not the row behind it: the API asks the question
   * of the whole `users` table, which a mock of one account cannot model.
   */
  takenEmails: string[];
  readonly seen: {
    updated: UpdateProfileBody[];
    /** Bodies the endpoint **accepted**. A refusal goes in `refused`. */
    changed: ChangePasswordBody[];
    refused: ChangePasswordBody[];
    /** Deletions the endpoint accepted, and the ones it refused. */
    deleted: DeleteProfileBody[];
    refusedDeletes: DeleteProfileBody[];
    /**
     * Address changes the endpoint **accepted** (ADR-0071 §6).
     *
     * There is no `changed` counterpart and there must not be: a `202` here
     * means a link was mailed and the account is untouched, so a mock that
     * moved `state.profile.email` would certify a client built on a lie about
     * the flow.
     */
    emailChangeRequests: ChangeEmailBody[];
  };
}

export const createProfileMockState = (
  profile: UserResource = PROFILE,
): ProfileMockState => ({
  profile: { ...profile },
  password: CURRENT_PASSWORD,
  otherSessionsRevoked: 0,
  allSessionsRevoked: false,
  takenEmails: [],
  seen: {
    updated: [],
    changed: [],
    refused: [],
    deleted: [],
    refusedDeletes: [],
    emailChangeRequests: [],
  },
});

/**
 * The self view's `deleted_at` filter, as far as a mock can see it (`D12.8`).
 *
 * `readSelf` excludes soft-deleted rows, so **every** `/user/profile` endpoint
 * answers `404` for a deleted account and not just the delete itself. Modelled
 * on all four rather than only on the one this step added, because ADR-0036's
 * rule is about the whole handler set: a mock that went on serving the profile
 * of a closed account would certify a client that kept reading it.
 *
 * Unreachable from a real client — the deletion revoked the session that could
 * ask, so a browser meets `401 AUTH_SESSION_REVOKED` first — which is exactly
 * why it has to be the mock that refuses rather than the suite remembering to.
 */
const gone = (state: ProfileMockState): Response | null =>
  state.profile.deletedAt === null ? null : fail(404, "NOT_FOUND");

export const createProfileHandlers = (state: ProfileMockState) =>
  [
    http.get(`${API}/profile`, () => gone(state) ?? ok(state.profile)),

    http.patch(`${API}/profile`, async ({ request }): Promise<Response> => {
      const refusal = gone(state);

      if (refusal !== null) return refusal;

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
        const refusal = gone(state);

        if (refusal !== null) return refusal;

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

    http.post(
      `${API}/profile/change-email`,
      async ({ request }): Promise<Response> => {
        const refusal = gone(state);

        if (refusal !== null) return refusal;

        const body = changeEmailBody.parse(await request.json());

        // The credential first, as the service has it: nothing is minted and
        // nothing is mailed until the actor has proven who they are
        // (ADR-0027's rule, ADR-0071 §6).
        if (body.currentPassword !== state.password) {
          return fail(403, "AUTH_CURRENT_PASSWORD_INVALID");
        }

        // The caller's own address included, which is what the API answers:
        // it is held by a live account — theirs.
        if (
          body.newEmail === state.profile.email ||
          state.takenEmails.includes(body.newEmail)
        ) {
          return fail(409, "USER_EMAIL_TAKEN");
        }

        state.seen.emailChangeRequests.push(body);

        /*
         * `202` and **the profile untouched**, which is the whole of what this
         * endpoint promises (ADR-0071 §6): the address moves when somebody
         * follows the link, on `/confirm-email`, and never here.
         */
        return ok({ accepted: true }, 202);
      },
    ),

    http.delete(`${API}/profile`, async ({ request }): Promise<Response> => {
      /*
       * The repeat, and the segment's own answer to it (ADR-0055 §4 as amended
       * at `D12.4`): `404`, not the admin path's `409 USER_DELETED`, because
       * the self view filters `deleted_at` and every other `/user/profile`
       * endpoint answers `404` for a deleted row — which is what `gone` is.
       * Before the body is even parsed, because the row is what is missing.
       */
      const refusal = gone(state);

      if (refusal !== null) return refusal;

      const body = deleteProfileBody.parse(await request.json());

      // The credential check comes before any state change, which is the order
      // the service uses: half a deletion is worse than none.
      if (body.currentPassword !== state.password) {
        state.seen.refusedDeletes.push(body);

        return fail(403, "AUTH_CURRENT_PASSWORD_INVALID");
      }

      state.seen.deleted.push(body);

      /*
       * ADR-0028's user semantics, carried exactly: the row survives, both
       * `deleted_at` and `status` are written so each column stays truthful on
       * its own, and every session goes — the caller's included, which is what
       * `clearAuthCookies` on the response is the browser-side half of.
       */
      state.profile = {
        ...state.profile,
        status: "disabled",
        deletedAt: "2026-08-31T12:00:00.000Z",
      };
      state.allSessionsRevoked = true;

      return new Response(null, { status: 204 });
    }),
  ] as const satisfies readonly HttpHandler[];
