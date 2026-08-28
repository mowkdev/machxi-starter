import {
  allowedCapabilities as allowedCapabilitiesBase,
  can as canBase,
  useAllowedCapabilities as useAllowedCapabilitiesBase,
  useCan as useCanBase,
  type CanFn as CanFnBase,
} from "@repo/app-services";

import type { GridCapabilities } from "@/shared/resource/types";
import type { PrincipalResource } from "@repo/contracts";

import {
  RESOURCE_POLICY,
  type ResourceAction,
  type ResourceName,
} from "./policy";

/**
 * `shared/auth` — facts about the *principal*, never about a row (ADR-0042).
 *
 * **The door and the data, which is the whole of `D9.6`'s split here.** The
 * predicate, the capability narrowing and the two hooks are
 * `@repo/app-services`'; `RESOURCE_POLICY` is not, and cannot be: it is a
 * transcription of `authorize(` calls in *this* API's routers, naming *this*
 * app's resources, pinned by `__tests__/policy.test.ts` against that
 * transcription. A package holding it would be a package holding one
 * deployment's authorization table.
 *
 * So this file binds the table once and re-exports every symbol under the name
 * and signature it had before the move — `useCan()` still takes no argument,
 * `can(principal, action, resource)` still takes three — and **no call site
 * above `shared/` changed.** It is the same shape `shared/i18n`'s door uses
 * for `createI18n` (`D9.2`) and `shared/grid`'s for `AppGrid` (`D9.4`).
 *
 * A barrel **by convention rather than by rule**, and saying so avoids a claim
 * the lint would not back: ADR-0032's public-API rule is expressed in
 * `eslint.config.js` as a `file: { path: "**\/index.{ts,tsx}" }` selector, and
 * every `allow` list reaches `shared` through `anyFileOf("shared")` instead —
 * `shared`'s slices are the app's toolbox, directories of small modules, where
 * an index per slice would be ceremony with no boundary to defend. So nothing
 * refuses `@/shared/auth/policy`; this exists so `RESOURCE_POLICY` has one
 * obvious door and a reviewer can find every consumer by grepping one path.
 *
 * The slice must stay small. It is the natural home for anything else that is a
 * fact about the principal, which is also the risk: it must not become the place
 * service-level rules are re-implemented. A `can` signature that grows a `row`
 * argument is the review trigger.
 */

export type CanFn = CanFnBase<ResourceAction, ResourceName>;

export const can = (
  principal: PrincipalResource | null,
  action: ResourceAction,
  resource: ResourceName,
): boolean => canBase(RESOURCE_POLICY, principal, action, resource);

/*
 * **The type arguments are explicit, and that is not decoration.** Inferred,
 * `TAction` comes out of `RESOURCE_POLICY`'s *literal keys* — so an action
 * that `ResourceAction` names and no row grants would narrow the returned
 * `CanFn` and fail this annotation, in this file rather than at a call site.
 * That action is exactly the deny-by-default case the `Partial` in
 * `ResourcePolicy` exists to express (`./policy`, ADR-0019 §Rules): absent
 * means `super_admin` only. Naming both parameters binds the vocabulary to
 * the union it belongs to and leaves the table free to have holes. Invisible
 * today only because `policy.test.ts` pins the table complete.
 */
export const useCan = (): CanFn =>
  useCanBase<ResourceName, ResourceAction>(RESOURCE_POLICY);

export const useAllowedCapabilities = (
  capabilities: GridCapabilities | undefined,
  resource: ResourceName,
): GridCapabilities | undefined =>
  useAllowedCapabilitiesBase(RESOURCE_POLICY, capabilities, resource);

/**
 * The narrowing, bound to this app's vocabulary like the three above it.
 *
 * Re-exporting the package's generic directly would have widened the third
 * parameter from `ResourceName` to any `string`, which is the one signature in
 * this door that would not have matched what shipped before the move.
 */
export const allowedCapabilities = (
  capabilities: GridCapabilities | undefined,
  canFn: CanFn,
  resource: ResourceName,
): GridCapabilities | undefined =>
  allowedCapabilitiesBase(capabilities, canFn, resource);
export {
  RESOURCE_POLICY,
  type ResourceAction,
  type ResourceName,
  type ResourcePolicy,
} from "./policy";
