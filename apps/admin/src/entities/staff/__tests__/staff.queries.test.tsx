import { listStaffQuery, type ListStaffQuery } from "@repo/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { createQueryClient } from "@/app/providers/query-client";
import { createApiClient } from "@/shared/api/client";
import { ApiProvider } from "@/shared/api/context";
import { createSessionStore } from "@/shared/api/session-store";
import { listOk } from "@/test/msw/handlers/envelope";
import { server } from "@/test/msw/server";

import { staffKeys } from "../staff.keys";
import { useStaffList } from "../staff.queries";

/**
 * The list hook and its key (ADR-0034).
 *
 * What is worth asserting is the seam, not the library: that a change in the
 * validated params is a *different cache entry* and therefore a real refetch,
 * and that the request that goes out carries the ADR-0014 wire form. Those two
 * are what make "the URL is the list state" true rather than aspirational.
 */

const API = "http://api.test/api/v1/admin";

const parse = (search: Record<string, unknown>): ListStaffQuery =>
  listStaffQuery.parse(search);

/**
 * One set of providers per test, reused across rerenders.
 *
 * The reuse is the point of the refetch test below: a fresh `QueryClient` would
 * have a fresh cache, so *any* rerender would refetch and the assertion would
 * pass without telling us anything about the key.
 */
const wrap = (ui: ReactNode) => {
  const store = createSessionStore();
  const client = createApiClient({ store, baseUrl: "http://api.test" });
  const queryClient = createQueryClient();

  const providers = (node: ReactNode) => (
    <ApiProvider value={{ client, store }}>
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    </ApiProvider>
  );

  const result = render(providers(ui));

  return {
    ...result,
    rerenderWith: (node: ReactNode) => {
      result.rerender(providers(node));
    },
  };
};

const Grid = ({ params }: { params: ListStaffQuery }) => {
  const { data, isFetching } = useStaffList(params);

  return (
    <div>
      <p>{isFetching ? "fetching" : "idle"}</p>
      <ul>
        {data?.items.map((staff) => (
          <li key={staff.id}>{staff.email}</li>
        ))}
      </ul>
    </div>
  );
};

describe("staffKeys", () => {
  it("nests so an invalidation can target every list at once", () => {
    // `lists()` is a prefix of `list(params)`, which is what lets a mutation
    // invalidate every page/sort/filter permutation without naming any.
    const params = parse({});

    expect(staffKeys.list(params).slice(0, 2)).toEqual(staffKeys.lists());
    expect(staffKeys.lists().slice(0, 1)).toEqual(staffKeys.all);
    expect(staffKeys.detail("abc")).toEqual(["staff", "detail", "abc"]);
  });
});

describe("useStaffList", () => {
  it("sends the ADR-0014 wire form and reads the envelope's own meta", async () => {
    const seen: string[] = [];

    server.use(
      http.get(`${API}/staff`, ({ request }) => {
        seen.push(new URL(request.url).search);

        return listOk({
          items: [{ id: "1", email: "ada@machxi.local" }],
          offset: 0,
          limit: 20,
          total: 1,
          sort: [],
          filters: {},
        });
      }),
    );

    wrap(
      <Grid
        params={parse({ sort: "-createdAt", filter: { status: "active" } })}
      />,
    );

    expect(await screen.findByText("ada@machxi.local")).toBeInTheDocument();
    expect(seen[0]).toContain("sort=-createdAt");
    expect(seen[0]).toContain("filter%5Bstatus%5D=active");
  });

  it("refetches when the params change, because the key changed", async () => {
    let calls = 0;

    server.use(
      http.get(`${API}/staff`, ({ request }) => {
        calls += 1;
        const offset = new URL(request.url).searchParams.get("offset") ?? "0";

        return listOk({
          items: [{ id: offset, email: `page-${offset}@machxi.local` }],
          offset: Number(offset),
          limit: 20,
          total: 40,
          sort: [],
          filters: {},
        });
      }),
    );

    const { rerenderWith } = wrap(<Grid params={parse({ offset: "0" })} />);

    expect(await screen.findByText("page-0@machxi.local")).toBeInTheDocument();
    expect(calls).toBe(1);

    // The navigation a pager performs: same component, **same cache**,
    // different validated params. TanStack Query hashes the key structurally,
    // so this is a different entry and therefore a real request — which is
    // what makes "the URL is the list state" true rather than aspirational.
    rerenderWith(<Grid params={parse({ offset: "20" })} />);

    await waitFor(() => {
      expect(screen.getByText("page-20@machxi.local")).toBeInTheDocument();
    });
    expect(calls).toBe(2);

    // And back again is free: the first page is still cached under its own key,
    // inside `staleTime`, so returning to it issues no third request.
    rerenderWith(<Grid params={parse({ offset: "0" })} />);

    await waitFor(() => {
      expect(screen.getByText("page-0@machxi.local")).toBeInTheDocument();
    });
    expect(calls).toBe(2);
  });
});
