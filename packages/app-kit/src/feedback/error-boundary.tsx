import { Component, type ReactNode } from "react";

import { AppCrash } from "../router/defaults";

/**
 * The top-level error boundary every SPA wraps its tree in (ADR-0062 §2).
 *
 * **Neither app had one.** A route's own error component catches what the
 * router catches — a loader that threw, a component the router rendered — and
 * nothing catches a throw from a provider, from the shell, or from a render
 * that happens between two navigations. What that costs is a white window with
 * nothing recorded anywhere, which is the failure mode a starter must not ship
 * with.
 *
 * **It renders copy, never the error.** `AppCrash` is the router default's
 * sentence with a reload beside it, so the two failures a person can meet look
 * like one product rather than like two bugs; the message, the stack and the
 * component trace go to the reporting seam of ADR-0066 §3 and nowhere else. A
 * class component because React offers no hook that catches a render throw.
 *
 * **The fallback carries the way out, and this component does not offer one.**
 * `failed` latches and is never reset: whatever threw is still in whatever
 * state produced it, so clearing the flag would re-run the same render on the
 * same inputs and land back here. `AppCrash` reloads instead.
 *
 * **Above the router and below the providers that give it copy** (§2). That
 * placement is what lets the fallback be translated: mounted at the very top
 * it would have no i18n instance and would have to carry an English literal.
 */
export interface ErrorBoundaryReport {
  (
    error: unknown,
    context?: {
      readonly boundary?: string;
      readonly route?: string;
    },
  ): void;
}

export interface AppErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * ADR-0066 §3's browser seam, or `undefined` in a build with no DSN — the
   * absence is what the caller branches on, so it is accepted rather than
   * required and a default build reports nothing and downloads no adapter.
   */
  readonly report?: ErrorBoundaryReport | undefined;
  /** Overridable so a suite can assert the boundary caught without copy. */
  readonly fallback?: ReactNode;
}

interface AppErrorBoundaryState {
  readonly failed: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    /*
     * `boundary: "app"` and nothing else. ADR-0066 §3's `ErrorContext` is
     * named fields only, never a bag of whatever was in scope — and what is in
     * scope at the top of a signed-in SPA is the session, the query cache and
     * every form on screen. React's own `componentStack` travels inside the
     * error the adapter receives, which is where a trace belongs.
     */
    this.props.report?.(error, { boundary: "app" });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return this.props.fallback ?? <AppCrash />;
  }
}
