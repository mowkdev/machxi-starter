import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";
import { createAppRouter } from "@/app/providers/router";
import { createSessionStore } from "@/shared/api/session-store";
import type { AppFeatures } from "@/shared/config";
import {
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import {
  PROFILE,
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import {
  INVITATION_ROWS,
  MEMBERSHIP_ROWS,
  ORGANIZATION_ROWS,
  RECEIVED_INVITATION,
  TEAM_ORGANIZATION,
  createOrganizationsHandlers,
  createOrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import { server } from "@repo/app-kit/testing";
import { authenticated, userPrincipal } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * Every route, under the pseudo-locale (ADR-0046 §10, §14) — this app's walk,
 * standing from its first screen (ADR-0055 §2).
 *
 * A real translation cannot prove the sweep finished — a Latvian reviewer
 * reading a screen sees Latvian and does not notice the one heading nobody
 * moved into a catalogue — and §8's lint rule sees JSX and four attributes and
 * not, for instance, a sentence built in a `.ts` file and handed to a
 * component. Under the lens every translated string is wrapped in brackets and
 * accented, so anything still in plain English is the only readable thing on
 * the page, and a machine can say which page it is on.
 *
 * **It walks the route tree rather than a list.** The paths come from the
 * router the app actually builds, so a screen added later is covered on arrival
 * rather than when somebody remembers to add it here — which is the failure
 * mode a hand-kept list has, and the whole reason this suite exists at
 * `D12.1`, when there is one route, instead of at the end when there are
 * fifteen. `D12.2` is that paying off for the first time: `/` arrived with the
 * guards and joined the walk without a line being added below.
 */

/**
 * Wrapped and accented, which is what `i18next-pseudo` does to a resolved
 * value: `Sign in` becomes `[Ṡḭḭḡṇ ḭḭṇ]`. The brackets are the assertion — an
 * accent alone would pass an em dash or an ellipsis that a hardcoded English
 * sentence happens to contain.
 */
const isPseudo = (text: string): boolean =>
  text.includes("[") && text.includes("]");

/**
 * What is on the page because it is *data*, and therefore has no business being
 * accented: what the principal carries, and what a component derived from it.
 *
 * **Filled in at `D12.5`, one step earlier than this file guessed.** It was
 * declared empty at `D12.1` with a note that `D12.6`'s profile form would give
 * it something; the account control got there first, because it greets the
 * signed-in customer by name and draws their initials. `D12.6` added the second
 * source it predicted: the account area shows the profile fixture's email and
 * two formatted timestamps.
 *
 * Derived from the fixtures rather than written out, so a renamed fixture cannot
 * quietly turn this suite into one that passes by allowing everything — and so
 * a *new* piece of copy can never land in the allow-list by accident, because
 * nothing but a fixture can get into it.
 */
const PRINCIPAL = userPrincipal();

/**
 * An expiry date as the invitation surfaces render it (`D15.5`).
 *
 * `en-GB` and `dateStyle: "medium"` are what `dateTimeFormat` resolves to under
 * this suite's locale, so this produces the same string the DOM holds rather
 * than a second opinion about it.
 */
const dayFormat = (value: string): string =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
    new Date(value),
  );

const DATA: readonly string[] = [
  PRINCIPAL.id,
  PRINCIPAL.email,
  PRINCIPAL.firstName ?? "",
  PRINCIPAL.lastName ?? "",
  `${PRINCIPAL.firstName ?? ""} ${PRINCIPAL.lastName ?? ""}`,
  // The account control's monogram, which is data twice over: derived from
  // data, and rendered by a component that never sees a catalogue.
  `${(PRINCIPAL.firstName ?? "").slice(0, 1)}${(PRINCIPAL.lastName ?? "").slice(0, 1)}`.toUpperCase(),
  /*
   * What `/account/profile` reads off `GET /user/profile` (`D12.6`). The
   * fixture's names and email are the principal's already; what is new is the
   * two instants, and they are put in as **formatted** strings rather than as
   * ISO ones, because what reaches the DOM is `Intl`'s output — a month name
   * that a locale spells in letters is exactly the kind of thing this walk
   * would otherwise report as untranslated English.
   */
  ...[PROFILE.createdAt, PROFILE.lastLoginAt]
    .filter((value): value is string => value !== null)
    .map((value) =>
      new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)),
    ),
  PROFILE.email,
  /*
   * What the organization screens and the switcher render off `GET /user/orgs`
   * and its two sub-lists (`D15.5`). Names, addresses and email addresses are
   * data by the same argument the profile's are — and so are the **formatted**
   * expiry dates, which reach the DOM as `Intl`'s output rather than as the ISO
   * strings the fixtures hold: a month name a locale spells in letters is
   * exactly what this walk would otherwise report as untranslated English.
   */
  ...ORGANIZATION_ROWS.flatMap((row) => [row.name, row.slug]),
  ...MEMBERSHIP_ROWS.flatMap((row) => [
    row.email,
    row.firstName ?? "",
    row.lastName ?? "",
    `${row.firstName ?? ""} ${row.lastName ?? ""}`,
  ]),
  ...INVITATION_ROWS.flatMap((row) => [
    row.email,
    row.organizationName,
    dayFormat(row.expiresAt),
  ]),
  RECEIVED_INVITATION.email,
  RECEIVED_INVITATION.organizationName,
  dayFormat(RECEIVED_INVITATION.expiresAt),
].filter((value) => value.trim() !== "");

/** Data, once every fixture string and every digit and mark is taken out of it. */
const isData = (text: string): boolean =>
  !/\p{L}{2,}/u.test(
    DATA.reduce<string>((rest, value) => rest.split(value).join(""), text),
  );

/** What an operator reads without seeing it — §8's list, which is §14's too. */
const READ_ATTRIBUTES = ["aria-label", "alt", "placeholder", "title"];

const unaccented = (root: HTMLElement): readonly string[] => {
  const found: string[] = [];
  const consider = (value: string | null | undefined, where: string): void => {
    const text = (value ?? "").trim();

    if (text === "" || isPseudo(text) || isData(text)) return;

    found.push(`${where}: ${text}`);
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) consider(walker.currentNode.nodeValue, "text");

  for (const element of root.querySelectorAll("*"))
    for (const attribute of READ_ATTRIBUTES)
      consider(element.getAttribute(attribute), attribute);

  return found;
};

/**
 * The leaves of the generated tree.
 *
 * `routesByPath` is keyed by the addresses the router resolves a location
 * against, so it is exactly the set a customer can reach — the pathless `_auth`
 * layout and the root are not in it, because nothing lands on them.
 *
 * Built rather than rendered, and that is not a style choice: `it.each` needs
 * the list while the file is being *collected*, and the jsdom stubs this suite
 * renders under are installed in `beforeAll` (`@repo/app-kit/testing/setup`). A
 * router is
 * a data structure until something mounts it, so asking one for its own routes
 * costs nothing and touches no DOM.
 */
/**
 * The fixture each route parameter is filled with (`D15.5`).
 *
 * The organization screens are the first addresses in this app that carry one,
 * and a walk that filtered them out would have reported green over two pages
 * nobody had looked at. The slug rather than the id, because the slug is what
 * this app's URLs carry (ADR-0067 §6) — and the *team* organization, since it
 * is the one whose settings screen renders every card the personal one hides.
 */
const PARAMS: Readonly<Record<string, string>> = {
  $orgSlug: TEAM_ORGANIZATION.slug,
};

const ROUTE_PATHS: readonly string[] = [
  ...new Set(
    Object.keys(createAppRouter().routesByPath).map((path) =>
      path.replace(/\$[A-Za-z0-9_]+/g, (param) => PARAMS[param] ?? param),
    ),
  ),
]
  .filter((path) => !path.includes("$"))
  .sort();

/**
 * The session each address has to be visited **in** to see the page it names.
 *
 * `/login`, `/register` and `/forgot-password` are the routes a signed-in
 * customer cannot reach: `_auth`'s mirror guard redirects them home, so
 * visiting any of them with a session would have walked the home screen twice
 * under the name of an auth screen — a page silently uncovered while the suite
 * reported two green. Every other address is behind the `_dashboard` guard and
 * needs the opposite, or — `/verify-email`, `/impersonate` and
 * `/reset-password` — wears its own shell and is happy either way.
 *
 * **`/auth/google` is visited anonymous although it wears its own shell too**
 * (`D19.3`): an arrival from Google's callback is ordinarily somebody with no
 * session yet, so that is the screen worth walking — and with a session and
 * nothing in the fragment it would render the same sentence anyway.
 */
const ANONYMOUS_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/auth/google",
];

/**
 * Every optional surface on (`D19.3`).
 *
 * The walk's job is to find copy nobody moved into a catalogue, and a surface
 * a build flag hides is copy the walk would otherwise never see —
 * "Continue with Google" is off in the suite's pinned environment, which is
 * the schema's default. Registration is already on there; it is named here so
 * the object says what the walk renders rather than what a pin happens to be.
 */
const ALL_FEATURES: AppFeatures = {
  userRegistration: true,
  googleSignIn: true,
};

const storeFor = (path: string) =>
  ANONYMOUS_PATHS.includes(path) ? createSessionStore() : authenticated();

/**
 * The endpoints these screens read (`D12.6`).
 *
 * The account area is the first surface in this app that fetches anything, and
 * the harness answers every request through MSW with
 * `onUnhandledRequest: "error"` — so a screen added later that reads something
 * new fails loudly here rather than walking a permanently empty page and
 * reporting green.
 */
beforeEach(() => {
  server.use(
    ...createAuthHandlers(createAuthMockState()),
    ...createProfileHandlers(createProfileMockState()),
    /*
     * `D15.5`: the switcher reads `GET /user/orgs` in the shell's header, so
     * **every** screen behind the guard now makes a request — which is the
     * sentence above paying out. Without these the walk failed on eight
     * addresses at once, each with the same unaccented failure toast.
     */
    ...createOrganizationsHandlers(createOrganizationsMockState()),
  );
});

describe("the route tree under the pseudo-locale", () => {
  it("covers every leaf the router can land on", () => {
    /*
     * The list is not maintained here; it is asserted to be non-trivial, so a
     * change that silently emptied it fails rather than passes vacuously. The
     * number is deliberately a floor rather than an equality, so a route added
     * by a later step joins the walk without editing this line.
     */
    expect(ROUTE_PATHS.length).toBeGreaterThanOrEqual(2);
    expect(ROUTE_PATHS).toContain("/login");
    expect(ROUTE_PATHS).toContain("/");
    /*
     * `/register` is named rather than left to the sweep (`D15.6`), because it
     * is the one address in this tree whose *existence* is a build flag: with
     * `VITE_FEATURE_USER_REGISTRATION` off its guard answers not-found, and a
     * walk that silently skipped it would report green over a screen nobody
     * had looked at. The route is in the tree either way — the flag gates the
     * guard, not the file — so this line is true in both builds.
     */
    expect(ROUTE_PATHS).toContain("/register");
    // Named because `ANONYMOUS_PATHS` names it: a list that names an address
    // the tree no longer has would quietly walk it signed in (`D19.3`).
    expect(ROUTE_PATHS).toContain("/auth/google");
    /*
     * **The two homes** (`D15.9`, ADR-0067 §6 as amended): the one page a
     * tenant screen is exists at `/` acting as the personal organization and at
     * `/orgs/$orgSlug` acting as a team, so the walk has to visit both — a
     * screen that read its context wrongly would be accented at one address and
     * not at the other, which is exactly the class of defect this suite is for.
     */
    expect(ROUTE_PATHS).toContain("/");
    expect(ROUTE_PATHS).toContain(`/orgs/${TEAM_ORGANIZATION.slug}`);
    /*
     * **The three settings sections**, named for the `/register` reason: they
     * are the addresses a customer reaches through the switcher's menu rather
     * than through a link on a screen the walk already visits, so a section
     * quietly dropped from the tree would take its copy out of this suite's
     * reach without failing anything.
     */
    for (const section of ["general", "members", "invitations"])
      expect(ROUTE_PATHS).toContain(
        `/orgs/${TEAM_ORGANIZATION.slug}/settings/${section}`,
      );

    /*
     * **What `D15.9` retired is a composition rather than an address**, which is
     * worth stating here because the obvious assertion is the wrong one: the
     * summary card lived at the team's home and is replaced by the home page at
     * that same path, and `/settings` is still in this list — as a layout route
     * that redirects to its first section, exactly as `/account` is. So the
     * retirement is checked by the screens' own suite, which asserts the
     * redirect and the sections, and this walk checks that every address that
     * remains has accented copy on it.
     */
    expect(ROUTE_PATHS).toContain(`/orgs/${TEAM_ORGANIZATION.slug}/settings`);
  });

  it.each(ROUTE_PATHS)("leaves nothing unaccented at %s", async (path) => {
    /*
     * The test's own cache, so the wait below can ask it a question (`D12.6`).
     * "Has the screen finished arriving" has no reliable answer in the DOM — a
     * skeleton is a component's choice — and `isFetching()` is the hooks' own
     * count of what is still in flight (ADR-0034). Without it the account
     * sections would be judged mid-skeleton, which is a page with no copy on it
     * and therefore vacuously accented.
     */
    const queryClient = createQueryClient();
    const { container, unmount } = renderApp({
      initialPath: path,
      store: storeFor(path),
      queryClient,
      pseudo: true,
      features: ALL_FEATURES,
    });

    /*
     * The page has to have arrived before it can be judged. Every screen here
     * renders at least one translated string, so waiting for the first bracket
     * is waiting for the route's own component rather than for a fixed delay.
     */
    await waitFor(() => {
      expect(container.textContent ?? "").toContain("[");
    });

    await waitFor(() => {
      expect(queryClient.isFetching()).toBe(0);
    });

    expect(unaccented(document.body as HTMLElement)).toEqual([]);

    unmount();
  });
});
