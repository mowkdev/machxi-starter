/**
 * The door onto `@repo/app-services`' grid density (`D11.6`, ADR-0051,
 * ADR-0053 §2).
 *
 * A slice of its own rather than a symbol added to `shared/theme`, for the
 * reason that door's name gives: it is the door onto *the theme*, and a second
 * display preference behind it would make the name a lie the first time
 * someone searched for one. The theme and the density are siblings — same
 * shape, same provider position, same account fact — not one thing.
 *
 * Three layers reach through it and none of them may import from `app`:
 * `features/density` renders the control, `shared/grid`'s `AppGrid` reads the
 * mode so no page has to remember to pass it, and `app/providers/settings.tsx`
 * is what connects the provider to an account.
 */
export {
  GridDensityProvider,
  useGridDensity,
  useGridDensityValue,
  type GridDensityProviderProps,
  type GridDensityView,
} from "@repo/app-services";
