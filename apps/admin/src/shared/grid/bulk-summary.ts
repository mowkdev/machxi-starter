/**
 * The door onto the bulk summariser (`D9.6`, ADR-0051).
 *
 * **It moved slice as well as package.** It shipped under
 * `shared/notifications`, which was right while `shared` was implementations:
 * ADR-0034's aggregate exception is a notification, and that slice is where
 * notifications lived. Every key it writes is `grid:bulk.*` though, and `D9.5`
 * settled that code travels with the copy it names — so the function is
 * `@repo/grid`'s and its door is this slice's. The two features that call it
 * moved one import path each; nothing else did.
 *
 * `shared/notifications` keeps what only this app can own: the `errors`
 * catalogue's readers (ADR-0046 §13).
 */
export { summariseBulk, type BulkSummary } from "@repo/grid";
