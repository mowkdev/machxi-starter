import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "@prometheus-io/client";
import type { Request, RequestHandler, Response } from "express";

/**
 * The Prometheus registry and the HTTP instrumentation behind it
 * (ADR-0066 §2).
 *
 * A `create*` factory holding the library in a closure (ADR-0009), and a
 * **private** registry rather than the package's global one: two registries in
 * one process would double-register every default metric, which is a throw,
 * and a test that builds two apps does exactly that.
 */

/** Buckets in seconds, from a fast read to a timing out request. */
const DURATION_BUCKETS = [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

/** What an unmatched request is labelled, so a 404 sweep cannot grow the label set. */
export const UNMATCHED_ROUTE = "unmatched";

/**
 * What a mount segment may look like: this API's own URL vocabulary, and
 * nothing a caller could invent (percent-encoding, unicode, punctuation).
 * Applied after lower-casing, so it is a whitelist of one case.
 */
const MOUNT_SEGMENT = /^[a-z0-9._~-]+$/;

/**
 * The **route pattern**, never the path (ADR-0066 §2).
 *
 * `/api/v1/admin/users/018f…/password` is one series per user id; the label
 * has to be `/api/v1/admin/users/:id/password` or the registry grows without
 * bound and the scrape eventually costs more than the traffic it describes.
 *
 * **Derived from `originalUrl` and `route.path`, deliberately not from
 * `baseUrl`.** Express restores `req.baseUrl` as it unwinds out of a mounted
 * router, so the obvious `baseUrl + route.path` is correct inside the handler
 * and empty by the time the error middleware or a `finish` listener reads it —
 * the same request would then be labelled `/api/v1/admin/auth/login` on the
 * happy path and `/login` on the failing one, which is two series for one
 * endpoint and a label that is wrong exactly when it matters. What survives
 * unwinding is `originalUrl` (the whole concrete path) and `route.path` (the
 * pattern of its tail), and the mount prefix is the one minus the other: drop
 * as many trailing segments from the path as the pattern has.
 *
 * **The prefix is lower-cased and checked, because it comes from the client.**
 * Express matches paths case-insensitively by default, so `/HeAlTh/LiVe` and
 * `/MeTrIcS` reach their handlers and `originalUrl` keeps whatever the caller
 * typed — which would make the prefix an *attacker-chosen* label value on two
 * routes that sit above every rate limiter, and every distinct value is a
 * counter plus twelve histogram children that are never evicted. A mount path
 * is only ever a literal we wrote, so folding case loses nothing and any
 * segment that does not look like one of ours is refused outright: the bound
 * on the label set is then a property of this function rather than of the
 * route table (`D14.6`'s `security-reviewer`).
 *
 * A request that matched nothing has no `route` at all: it is labelled once,
 * as {@link UNMATCHED_ROUTE}, which is the whole point of naming it.
 */
export const routeLabel = (req: Request): string => {
  const { route } = req as Request & { route?: { path?: unknown } };
  // Annotated, because `@types/express` declares `Request["route"]` as `any`:
  // without it the narrowing below produces `any` and every callback here
  // becomes implicitly typed.
  const pattern: string | undefined =
    typeof route?.path === "string" ? route.path : undefined;

  if (pattern === undefined) return UNMATCHED_ROUTE;

  const patternSegments = pattern.split("/").filter((part) => part !== "");
  const pathSegments = (req.originalUrl.split("?")[0] ?? "")
    .split("/")
    .filter((part) => part !== "");
  const prefixSegments = pathSegments
    .slice(0, Math.max(0, pathSegments.length - patternSegments.length))
    .map((part) => part.toLowerCase());

  if (!prefixSegments.every((part) => MOUNT_SEGMENT.test(part))) {
    return UNMATCHED_ROUTE;
  }

  const prefix = prefixSegments.map((part) => `/${part}`).join("");
  const label = `${prefix}${pattern}`;

  // `router.get('/')` under a mount produces `'/api/v1/admin/staff' + '/'`;
  // the trailing slash is noise that would split one endpoint into two series
  // the moment anything reported it the other way.
  return label.length > 1 && label.endsWith("/") ? label.slice(0, -1) : label;
};

/** `2xx`, `4xx`, `5xx` — the family, not the code: three series instead of forty. */
export const statusClass = (status: number): string =>
  `${String(Math.floor(status / 100))}xx`;

export interface Metrics {
  /** Rendered by `GET /metrics`; nothing else reads it. */
  readonly render: () => Promise<{
    readonly contentType: string;
    readonly body: string;
  }>;
  /**
   * Counts and times every request, including the ones that never matched a
   * route. Mounted once, above the router (ADR-0011's order is unchanged: this
   * is a wrapper, not a sixth entry).
   */
  readonly middleware: RequestHandler;
}

export const createMetrics = (): Metrics => {
  const registry = new Registry();

  // Event-loop lag, heap, handles, GC, and the process's own `up`. The reason
  // `prom-client` is the one dependency here that is *not* inert without
  // configuration: the registry is the endpoint (ADR-0066 §Consequences).
  collectDefaultMetrics({ register: registry });

  const requests = new Counter({
    name: "http_requests_total",
    help: "HTTP requests handled, by route pattern, method and status class.",
    labelNames: ["method", "route", "status"] as const,
    registers: [registry],
  });

  const duration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds, by route pattern, method and status class.",
    labelNames: ["method", "route", "status"] as const,
    buckets: [...DURATION_BUCKETS],
    registers: [registry],
  });

  return {
    render: async () => ({
      contentType: registry.contentType,
      body: await registry.metrics(),
    }),

    middleware: (req: Request, res: Response, next) => {
      const startedAt = process.hrtime.bigint();

      // `finish` and not `close`: the route is only known once Express has
      // matched one, and a client that hangs up early would otherwise be
      // recorded as `unmatched` even though it reached a handler.
      res.once("finish", () => {
        const seconds =
          Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
        const labels = {
          method: req.method,
          route: routeLabel(req),
          status: statusClass(res.statusCode),
        } as const;

        requests.inc(labels);
        duration.observe(labels, seconds);
      });

      next();
    },
  } as const;
};
