/**
 * The door onto the kit's principal-cache boundary (`D22.1`, ADR-0077 §1).
 * See `./api-error`.
 *
 * `app/providers/principal-cache.tsx` binds it to this app's key function.
 */
export {
  createPrincipalCache,
  type PrincipalCache,
  type PrincipalCacheBoundaryProps,
} from "@repo/app-kit";
