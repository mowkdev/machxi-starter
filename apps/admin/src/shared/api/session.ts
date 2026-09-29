/**
 * The door onto the kit's session (`D22.1`, ADR-0077 §1). See `./api-error`.
 *
 * The factory, not a session: `app/providers/session.tsx` calls it once with
 * this app's segment, its API address and its sentence, and that call is the
 * whole of what the app states.
 */
export {
  createAppSession,
  type AppSession,
  type AppSessionOptions,
  type SessionProviderProps,
} from "@repo/app-kit";
