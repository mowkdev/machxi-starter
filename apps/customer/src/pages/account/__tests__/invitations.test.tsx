import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  API,
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { fail, server } from "@repo/app-kit/testing";
import {
  RECEIVED_INVITATION,
  createOrganizationsHandlers,
  createOrganizationsMockState,
  type OrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { authenticated } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * `/account/invitations` (`D15.5`; ADR-0053 §1, ADR-0067 §4).
 *
 * The claim worth a whole suite is the last one: **accepting an invitation puts
 * the organization in the switcher**. That crosses three things that could each
 * be wired wrongly on their own — the endpoint answering with the organization
 * rather than `204`, the entity hook invalidating both lists rather than one,
 * and the switcher reading the list it invalidated — and none of the three is
 * visible from a component test of the section alone.
 */
let state: OrganizationsMockState;

beforeEach(() => {
  state = createOrganizationsMockState();

  server.use(
    ...createAuthHandlers(createAuthMockState()),
    ...createProfileHandlers(createProfileMockState()),
    ...createOrganizationsHandlers(state),
  );
});

describe("the account area's invitations section", () => {
  it("is a section of the account area, named in the nav", async () => {
    renderApp({ initialPath: "/account/invitations", store: authenticated() });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Invitations" }),
    ).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Account sections" });

    expect(
      within(nav).getByRole("link", { name: "Invitations" }),
    ).toHaveAttribute("data-active", "true");
  });

  it("lists what has been offered to the caller's address", async () => {
    renderApp({ initialPath: "/account/invitations", store: authenticated() });

    expect(
      await screen.findByText(RECEIVED_INVITATION.organizationName),
    ).toBeInTheDocument();
    // The role the offer names, in the catalogue's word rather than the wire's.
    expect(screen.getByText("Invited as Admin")).toBeInTheDocument();
  });

  it("accepting one puts the organization in the switcher", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/account/invitations", store: authenticated() });

    await screen.findByText(RECEIVED_INVITATION.organizationName);

    await user.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => {
      expect(state.seen.accepted).toEqual([RECEIVED_INVITATION.id]);
    });

    /*
     * The switcher is in the shell above this section, so this assertion is
     * about the invalidation reaching a control the section knows nothing
     * about — which is the whole reason the two lists are invalidated by the
     * entity layer rather than by whichever surface happened to write.
     */
    await user.click(
      await screen.findByRole("button", { name: "Switch organization" }),
    );

    expect(
      await within(await screen.findByRole("menu")).findByRole("menuitem", {
        name: new RegExp(RECEIVED_INVITATION.organizationName),
      }),
    ).toBeInTheDocument();
  });

  it("renders the exclusion in the catalogue's words when accepting is refused", async () => {
    const user = userEvent.setup();

    /*
     * ADR-0067 §8's grown exclusion list, proved once on the write it was
     * written for: an operator acting as a customer must not be able to walk
     * that account into somebody else's tenant. Nothing on this screen hides
     * the control — the refusal is the API's and arrives as a code — so what
     * this asserts is the half the client owns: the code becomes the
     * catalogue's sentence and never the API's `error.message` (ADR-0013).
     */
    server.use(
      http.post(`${API}/invitations/:id/accept`, () =>
        fail(403, "AUTH_IMPERSONATION_REFUSED"),
      ),
    );

    renderApp({ initialPath: "/account/invitations", store: authenticated() });

    await screen.findByText(RECEIVED_INVITATION.organizationName);

    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(
      await screen.findByText(
        "That cannot be done while impersonating this account. The account holder has to do it themselves.",
      ),
    ).toBeInTheDocument();
    // The offer is still there to try again as the account holder.
    expect(
      screen.getByText(RECEIVED_INVITATION.organizationName),
    ).toBeInTheDocument();
  });

  it("declining one ends the offer and joins nothing", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/account/invitations", store: authenticated() });

    await screen.findByText(RECEIVED_INVITATION.organizationName);

    await user.click(screen.getByRole("button", { name: "Decline" }));

    await waitFor(() => {
      expect(state.seen.declined).toEqual([RECEIVED_INVITATION.id]);
    });

    // The offer is gone and the caller's organizations are untouched, which is
    // the one line that separates declining from accepting.
    expect(
      await screen.findByText("Nobody has invited you to an organization."),
    ).toBeInTheDocument();
    expect(
      state.organizations.some(
        (row) => row.name === RECEIVED_INVITATION.organizationName,
      ),
    ).toBe(false);
  });
});
