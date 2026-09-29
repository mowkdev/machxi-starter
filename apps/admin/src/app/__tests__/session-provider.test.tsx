import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionProvider, apiClient } from "@/app/providers/session";

/**
 * The session's binding (ADR-0077 §1 and §4).
 *
 * The gate itself — the ordering, `StrictMode`, the boot sequence — is
 * certified in `@repo/app-kit`, which has owned it since `D22.1`. What this
 * app states is two things, and this is the smoke test that they arrived: the
 * segment, and the sentence with the variable it names.
 */
describe("the admin's session", () => {
  it("is the staff segment's, and names the variable to the operator", async () => {
    expect(apiClient.instance.defaults.baseURL?.endsWith("/api/v1/admin")).toBe(
      true,
    );

    // A rejection means `GET /auth/csrf` itself failed — the API is down or
    // misconfigured. The person reading this runs the panel, so the sentence
    // names the variable that points at the API.
    render(
      <SessionProvider
        bootstrap={() => Promise.reject(new Error("boom"))}
        fallback={<p>Starting…</p>}
      >
        <p>Protected content</p>
      </SessionProvider>,
    );

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/not reachable/i);
    expect(alert).toHaveTextContent("VITE_API_URL");
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });
});
