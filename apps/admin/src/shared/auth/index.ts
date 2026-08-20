/**
 * `shared/auth` — facts about the *principal*, never about a row (ADR-0042).
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
export { can, type CanFn } from "./can";
export { allowedCapabilities } from "./capabilities";
export { useAllowedCapabilities, useCan } from "./context";
export {
  RESOURCE_POLICY,
  type ResourceAction,
  type ResourceName,
  type ResourcePolicy,
} from "./policy";
