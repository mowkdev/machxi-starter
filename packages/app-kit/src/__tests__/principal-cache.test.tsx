import {
  ApiProvider,
  createApiClient,
  createSessionStore,
  type SessionStore,
} from "@repo/api-client";
import type {
  StaffPrincipalResource,
  UserPrincipalResource,
} from "@repo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createPrincipalCache } from "../providers/principal-cache";

/**
 * One principal's cache does not become the next one's (`D13.6`), certified in
 * the package that owns the boundary since `D22.1` (ADR-0077 §1 and §4).
 *
 * The kit's half is the mechanism: an owner string, compared in the render
 * phase, and a cache emptied before any child renders. What the owner is made
 * of is the app's function, and each app's own `principal-cache.test.tsx`
 * proves its binding together with the settings subtree it keys.
 */

const FIRST = "0198c1f0-0000-7000-8000-0000000000a1";
const SECOND = "0198c1f0-0000-7000-8000-0000000000b2";
const OPERATOR = "0198c1f0-0000-7000-8000-0000000000e3";

const staff = (id: string): StaffPrincipalResource => ({
  kind: "staff",
  id,
  email: `${id}@machxi.local`,
  firstName: "Sam",
  lastName: "Staff",
  roles: ["admin"],
});

const user = (
  id: string,
  impersonatedBy?: UserPrincipalResource["impersonatedBy"],
): UserPrincipalResource => ({
  kind: "user",
  id,
  email: `${id}@machxi.local`,
  firstName: "Cara",
  lastName: "Customer",
  roles: ["customer"],
  ...(impersonatedBy ? { impersonatedBy } : {}),
});

const byIdentity = createPrincipalCache(
  (principal) => `${principal.kind}:${principal.id}`,
);

const renderUnder = (
  cache: ReturnType<typeof createPrincipalCache>,
  store: SessionStore,
) => {
  const queryClient = new QueryClient();
  const client = createApiClient({
    store,
    baseUrl: "http://api.test",
    segment: "user",
  });

  const Owner = () => (
    <output data-testid="owner">{cache.usePrincipalCacheOwner()}</output>
  );

  render(
    <ApiProvider value={{ client, store }}>
      <QueryClientProvider client={queryClient}>
        <cache.PrincipalCacheBoundary>
          <Owner />
        </cache.PrincipalCacheBoundary>
      </QueryClientProvider>
    </ApiProvider>,
  );

  return { queryClient };
};

const signIn = (
  store: SessionStore,
  principal: StaffPrincipalResource | UserPrincipalResource,
) => {
  store.setSession({ accessToken: `token-for-${principal.id}`, principal });
};

describe("createPrincipalCache", () => {
  it("the principal cache key is the app's function", () => {
    const ownerOf = vi.fn(
      (principal: { kind: string; id: string }) =>
        `bound:${principal.kind}:${principal.id}`,
    );
    const cache = createPrincipalCache(ownerOf);

    expect(cache.principalCacheOwner(staff(FIRST))).toBe(
      `bound:staff:${FIRST}`,
    );
    expect(ownerOf).toHaveBeenCalledWith(staff(FIRST));

    const store = createSessionStore();
    signIn(store, user(SECOND));
    renderUnder(cache, store);

    expect(screen.getByTestId("owner")).toHaveTextContent(
      `bound:user:${SECOND}`,
    );
  });

  it("answers for nobody itself, without asking the app", () => {
    const ownerOf = vi.fn(() => "never");
    const cache = createPrincipalCache(ownerOf);

    expect(cache.principalCacheOwner(null)).toBe("anonymous");
    expect(ownerOf).not.toHaveBeenCalled();
  });

  it("empties the cache when the owner changes", () => {
    const store = createSessionStore();
    signIn(store, staff(FIRST));

    const { queryClient } = renderUnder(byIdentity, store);

    queryClient.setQueryData(["profile", "detail"], { id: FIRST });

    act(() => {
      signIn(store, staff(SECOND));
    });

    expect(screen.getByTestId("owner")).toHaveTextContent(`staff:${SECOND}`);
    expect(queryClient.getQueryData(["profile", "detail"])).toBeUndefined();
  });

  it("treats a sign-out as a change of owner", () => {
    const store = createSessionStore();
    signIn(store, staff(FIRST));

    const { queryClient } = renderUnder(byIdentity, store);

    queryClient.setQueryData(["profile", "detail"], { id: FIRST });

    act(() => {
      store.clear();
    });

    expect(screen.getByTestId("owner")).toHaveTextContent("anonymous");
    expect(queryClient.getQueryData(["profile", "detail"])).toBeUndefined();
  });

  it("keeps the cache while the owner stands", () => {
    const store = createSessionStore();
    signIn(store, staff(FIRST));

    const { queryClient } = renderUnder(byIdentity, store);

    queryClient.setQueryData(["profile", "detail"], { id: FIRST });

    // A rotated token is the same principal: nothing about who the cache
    // belongs to has changed, so nothing is evicted.
    act(() => {
      store.setSession({ accessToken: "rotated", principal: staff(FIRST) });
    });

    expect(queryClient.getQueryData(["profile", "detail"])).toEqual({
      id: FIRST,
    });
  });

  it("evicts on whatever the app's function distinguishes", () => {
    /*
     * The customer app's key, as a parameter: identity *and* actor, because
     * one customer id is reachable two ways (ADR-0057 §4). The kit decides
     * nothing about it — a function that tells the two sessions apart evicts
     * between them, and one that does not would not.
     */
    const byActor = createPrincipalCache((principal) => {
      const actor =
        principal.kind === "user" ? principal.impersonatedBy : undefined;

      return actor == null
        ? `${principal.kind}:${principal.id}`
        : `${principal.kind}:${principal.id}#actor:${actor.id}`;
    });

    const store = createSessionStore();
    signIn(store, user(FIRST));

    const { queryClient } = renderUnder(byActor, store);

    queryClient.setQueryData(["profile", "detail"], { id: FIRST });

    act(() => {
      signIn(
        store,
        user(FIRST, { id: OPERATOR, email: "operator@machxi.local" }),
      );
    });

    expect(screen.getByTestId("owner")).toHaveTextContent(
      `user:${FIRST}#actor:${OPERATOR}`,
    );
    expect(queryClient.getQueryData(["profile", "detail"])).toBeUndefined();
  });
});
