/**
 * The door onto `@repo/app-services`' grid density (ADR-0051, ADR-0053 §2,
 * ADR-0055 §3).
 *
 * A slice of its own rather than a symbol added to `shared/theme`, for the
 * reason that door's name gives: it is the door onto *the theme*, and a second
 * display preference behind it would make the name a lie the first time
 * someone searched for one. The theme and the density are siblings — same
 * shape, same provider position, same account fact — not one thing.
 *
 * **This app has no grid, and the door is still here.** ADR-0055 §3 says the
 * density is "an account fact whether or not a grid is mounted yet": a customer
 * who chooses Compact chooses it for the app, and the choice has to survive
 * until the first domain entity brings a table to spend it on. So the fact is
 * stored and offered, and the one thing missing is a reader — which is why
 * `useGridDensityValue` is deliberately **not** re-exported. That hook is for
 * surfaces that only render at the mode, and this app has none; a door line
 * with no consumer is the slot-with-no-consumer defect ADR-0048 §2 spends a
 * paragraph on, one layer down.
 *
 * Two layers reach through it and neither may import from `app`:
 * `features/density` renders the control, and `app/providers/settings.tsx` is
 * what connects the provider to an account.
 */
export {
  GridDensityProvider,
  useGridDensity,
  type GridDensityProviderProps,
  type GridDensityView,
} from "@repo/app-services";
