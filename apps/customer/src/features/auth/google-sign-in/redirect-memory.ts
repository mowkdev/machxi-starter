import { DEVICE_KEY_PREFIX } from "@/shared/config";
import { relativePath } from "@/shared/lib/relative-path";

/**
 * Where a Google sign-in should land, carried across the round trip by this
 * app and never by the API (ADR-0072 §4, amended after `D19.3`).
 *
 * The sign-in screen's `redirect` — the location `_dashboard`'s guard turned
 * away, or the invitation screen's way back — would be lost at the navigation
 * to Google, so "Continue with Google" leaves it here before leaving, and the
 * landing route takes it once on the way back. **Session storage**, because
 * the fact is one tab's and one round trip's, and it dies with the tab; under
 * the app's device-key prefix (ADR-0064 §1), so a fork's brand owns the key.
 * It is a location, not a credential, which is what the session rule allows
 * a browser store to hold (ADR-0033).
 *
 * **Fenced on the way out as well as on the way in.** `/login`'s route already
 * refused anything that is not a path on this origin, and the value is read
 * back through the same `relativePath` — storage is writable by any script on
 * the origin, and the fragment, which an attacker's link could set, is never
 * consulted at all. Anything that fails lands home.
 *
 * Every access is wrapped: storage can be absent or refuse (a private window,
 * blocked site data), and a sign-in that cannot remember where it was going
 * still signs in, at `/`.
 */
const KEY = `${DEVICE_KEY_PREFIX}.googleRedirect`;

/**
 * Leaves `path` for the landing route, or clears a value an earlier,
 * abandoned attempt left — so a start from a screen with no `redirect` never
 * inherits one.
 */
export const rememberRedirect = (path: string | undefined): void => {
  try {
    if (path === undefined) {
      window.sessionStorage.removeItem(KEY);
    } else {
      window.sessionStorage.setItem(KEY, path);
    }
  } catch {
    // Nothing to remember into; the landing goes home.
  }
};

/** Reads the remembered location once, removes it, and fences it. */
export const takeRedirect = (): string | undefined => {
  try {
    const value = window.sessionStorage.getItem(KEY);

    window.sessionStorage.removeItem(KEY);

    return value !== null && value.length <= 2048 && relativePath(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};
