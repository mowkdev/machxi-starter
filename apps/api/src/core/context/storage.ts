import { AsyncLocalStorage } from "node:async_hooks";

import type { RequestContext } from "./request-context.js";

/**
 * `AsyncLocalStorage` propagation of the request context (ADR-0010).
 *
 * The context middleware runs the rest of the chain inside `runWithContext`,
 * so any code below it can reach the current context without taking it as a
 * parameter. That is for **infrastructure** — the error handler, a shared
 * repository helper stamping `updatedBy`, an audit hook. Services take `ctx`
 * explicitly and are kept off `getContext()` by a lint rule (ADR-0002), because
 * an implicit dependency is invisible in a signature and forces every unit test
 * to build a storage harness.
 *
 * Module-level state is deliberate here and is not the singleton ADR-0009
 * forbids: it holds no configuration and no connection, only the ambient value
 * of whatever request is currently executing.
 */
const contextStorage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `ctx` as the ambient context. */
export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T =>
  contextStorage.run(ctx, fn);

/**
 * The current context, or `undefined` outside a request. Prefer
 * {@link getContext} where a context is genuinely required.
 */
export const tryGetContext = (): RequestContext | undefined =>
  contextStorage.getStore();

/**
 * The current context.
 *
 * @throws Error when called outside a request — a programming error, not a
 *   runtime condition: the caller reached for ambient state where none exists
 *   and should take a `ctx` parameter instead.
 */
export const getContext = (): RequestContext => {
  const ctx = contextStorage.getStore();

  if (ctx === undefined) {
    throw new Error(
      "getContext() was called outside a request. Pass the context explicitly, or use createSystemContext() for non-HTTP entry points (ADR-0010).",
    );
  }

  return ctx;
};
