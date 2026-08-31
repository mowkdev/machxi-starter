import { useT } from "@/shared/i18n";

/**
 * What a customer meets when a route throws, and when a route does not exist
 * (ADR-0013, `D12.2`'s review).
 *
 * **The router's own defaults are not acceptable here, and that is the whole
 * reason this file exists.** TanStack's `ErrorComponent` renders "Something
 * went wrong!" with a **Show Error** button that prints `error.message` into a
 * `<pre>` — and the button ships in production; only whether it starts expanded
 * depends on `NODE_ENV`. For anything that rejects out of a route, that message
 * is an `ApiClientError.message`, which is the API's developer-facing English
 * default (ADR-0013) and the exact string the login form spends a test case
 * keeping off the screen. Leaving the default in place would have made the
 * careful path the loud one and the accidental path the leaky one.
 *
 * So both take the same shape as `SessionProvider`'s unreachable notice: one
 * written sentence from the `errors` catalogue, `role="alert"`, and nothing
 * carried across from the failure itself. What a developer needs is in the
 * console and in the API's logs against the request id, which is where
 * ADR-0013 puts it.
 *
 * The error is deliberately not a parameter: there is nothing this component
 * could do with it that would not be a way of showing it.
 */
const Notice = ({ children }: { children: string }) => (
  <div
    className="flex min-h-svh items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground"
    role="alert"
  >
    {children}
  </div>
);

/** Any route that threw — a failed loader, a component that crashed. */
export const AppError = () => {
  const { t } = useT("errors");

  return <Notice>{t("fallback")}</Notice>;
};

/**
 * An address that matches no route.
 *
 * `ROUTE_NOT_FOUND` rather than a key of its own: the catalogue is keyed by
 * `ErrorCode` and this is the client-side occurrence of exactly that code, so
 * a customer reads the same sentence whether the router or the API decided the
 * address does not exist.
 */
export const AppNotFound = () => {
  const { t } = useT("errors");

  return <Notice>{t("ROUTE_NOT_FOUND")}</Notice>;
};
