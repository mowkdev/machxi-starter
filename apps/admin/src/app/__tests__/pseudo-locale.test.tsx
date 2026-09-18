import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";
import { createAppRouter } from "@/app/providers/router";
import { createApiClient } from "@/shared/api/client";
import { createSessionStore } from "@/shared/api/session-store";
import {
  STAFF_ROWS,
  createStaffHandlers,
  createStaffMockState,
} from "@/test/msw/handlers/staff.handlers";
import {
  USER_ROWS,
  createUsersHandlers,
  createUsersMockState,
} from "@/test/msw/handlers/users.handlers";
import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import {
  createSettingsHandlers,
  createSettingsMockState,
} from "@/test/msw/handlers/settings.handlers";
import { server } from "@repo/app-kit/testing";
import { renderApp } from "@/test/render";
import {
  ORGANIZATIONS_ROWS,
  ORGANIZATION_MEMBER_ROWS,
  createOrganizationMockState,
  createOrganizationsHandlers,
} from "@/test/msw/handlers/organizations.handlers";
import { staffPrincipal } from "@/test/principals";

/**
 * Every route, under the pseudo-locale (ADR-0046 §10, §14).
 *
 * This is the executable half of the deliverable's acceptance walk. A real
 * translation cannot prove the sweep finished — a Latvian reviewer reading a
 * screen sees Latvian and does not notice the one heading nobody moved into a
 * catalogue — and the lint rule of §8 sees JSX and four attributes and not, for
 * instance, a sentence built in a `.ts` file and handed to a component. Under
 * the lens every translated string is wrapped in brackets and accented, so
 * anything still in plain English is the only readable thing on the page, and a
 * machine can say which page it is on.
 *
 * **It walks the route tree rather than a list.** The paths come from the
 * router the app actually builds, so a page added later is covered on arrival
 * rather than when somebody remembers to add it here — which is the failure mode
 * a hand-kept list has and the reason ADR-0046 §14 spells the requirement that
 * way.
 */

/** The seeded records the record routes open. */
const [staffRow] = STAFF_ROWS;
const [userRow] = USER_ROWS;
const [organizationRow] = ORGANIZATIONS_ROWS;

if (
  staffRow === undefined ||
  userRow === undefined ||
  organizationRow === undefined
)
  throw new Error("the fixtures are empty");

const PARAMS: Readonly<Record<string, string>> = {
  $staffId: staffRow.id,
  $userId: userRow.id,
  $organizationId: organizationRow.id,
};

/** The fixtures these screens read, built once so the allow-list can be derived. */
const STAFF_STATE = createStaffMockState();
const USERS_STATE = createUsersMockState();
const ORGANIZATIONS_STATE = createOrganizationMockState();
const PROFILE_STATE = createProfileMockState();
const SETTINGS_STATE = createSettingsMockState();
const PRINCIPAL = staffPrincipal(["super_admin"]);

/**
 * The strings on these screens that are **data**, and therefore have no business
 * being accented: what the fixtures seeded, what the principal carries, and what
 * `Intl` formatted out of a timestamp.
 *
 * Derived from the fixtures rather than written out, so a renamed fixture cannot
 * quietly turn this suite into one that passes by allowing everything — and so a
 * *new* piece of copy can never land in the allow-list by accident, because
 * nothing but a fixture can get into it.
 */
const people = [
  ...STAFF_STATE.rows,
  ...USERS_STATE.rows,
  PROFILE_STATE.profile,
  PRINCIPAL,
];

const MONTHS = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("en-GB", { month: "short" }).format(
    new Date(Date.UTC(2026, month, 15)),
  ),
);

const DATA: readonly string[] = [
  /*
   * A tenant's own name and address are fixture data, exactly as a person's
   * are — and the members section renders both, so a screen that showed them
   * unaccented would otherwise read as a hardcoded English sentence.
   */
  ...ORGANIZATIONS_STATE.rows.flatMap((organization) => [
    organization.id,
    organization.name,
    organization.slug,
  ]),
  ...ORGANIZATION_MEMBER_ROWS.flatMap((member) => [
    member.userId,
    member.email,
    member.firstName ?? "",
    member.lastName ?? "",
    `${member.firstName ?? ""} ${member.lastName ?? ""}`,
  ]),
  ...people.flatMap((person) => [
    person.id,
    person.email,
    person.firstName ?? "",
    person.lastName ?? "",
    `${person.firstName ?? ""} ${person.lastName ?? ""}`,
    // The avatar's initials, which are data twice over: derived from data, and
    // rendered by a component that never sees a catalogue.
    `${(person.firstName ?? "").slice(0, 1)}${(person.lastName ?? "").slice(0, 1)}`,
  ]),
  ...MONTHS,
].filter((value) => value.trim() !== "");

/**
 * Wrapped and accented, which is what `i18next-pseudo` does to a resolved
 * value: `Save changes` becomes `[Šààṽḛḛ ͼḥααṇḡḛḛṡ]`. The brackets are the
 * assertion — an accent alone would pass an em dash or an ellipsis that a
 * hardcoded English sentence happens to contain.
 */
const isPseudo = (text: string): boolean =>
  text.includes("[") && text.includes("]");

/** Data, once every seeded string and every digit and mark is taken out of it. */
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
 * The session each address has to be visited **in** to see the page it names.
 *
 * `/login` and `/forgot-password` are the routes a signed-in operator cannot
 * reach: the `_auth` layout's mirror guard redirects them to the dashboard, so
 * visiting either with a session would have walked the dashboard twice under
 * the name of an auth screen — a page silently uncovered while the suite
 * reported ten green. Every other address is behind the `_dashboard` guard and
 * needs the opposite, save `/reset-password`, which wears its own shell and is
 * happy either way (`D18.6`).
 */
const ANONYMOUS_PATHS = ["/login", "/forgot-password"];

const storeFor = (path: string) => {
  const store = createSessionStore();

  if (!ANONYMOUS_PATHS.includes(path))
    store.setSession({
      accessToken: "test-access-token",
      principal: PRINCIPAL,
    });

  return store;
};

beforeEach(() => {
  server.use(
    ...createStaffHandlers(STAFF_STATE),
    ...createUsersHandlers(USERS_STATE),
    ...createOrganizationsHandlers(ORGANIZATIONS_STATE),
    ...createProfileHandlers(PROFILE_STATE),
    ...createSettingsHandlers(SETTINGS_STATE),
  );
});

/**
 * The leaves of the generated tree, with their parameters filled in.
 *
 * `routesByPath` is keyed by the addresses the router resolves a location
 * against, so it is exactly the set an operator can reach — the two pathless
 * layouts and the root are not in it, because nothing lands on them.
 *
 * Built rather than rendered, and that is not a style choice: `it.each` needs
 * the list while the file is being *collected*, and the jsdom stubs this suite
 * renders under are installed in `beforeAll` (`@repo/app-kit/testing/setup`). A
 * router is
 * a data structure until something mounts it, so asking one for its own routes
 * costs nothing and touches no DOM.
 */
const ROUTE_PATHS: readonly string[] = [
  ...new Set(
    Object.keys(
      createAppRouter({
        client: createApiClient({
          store: createSessionStore(),
          baseUrl: "http://api.test",
          segment: "admin",
        }),
      }).routesByPath,
    )
      .map((path) =>
        path.replace(/\$[A-Za-z0-9_]+/g, (param) => PARAMS[param] ?? param),
      )
      .filter((path) => !path.includes("$"))
      .sort(),
  ),
];

describe("the route tree under the pseudo-locale", () => {
  it("covers every leaf the router can land on", () => {
    // The list is not maintained here; it is asserted to be non-trivial, so a
    // change that silently emptied it fails rather than passes vacuously.
    expect(ROUTE_PATHS.length).toBeGreaterThanOrEqual(8);
  });

  it.each(ROUTE_PATHS)("leaves nothing unaccented at %s", async (path) => {
    /*
     * The test's own cache, so the wait below can ask it a question. "Has the
     * screen finished arriving" has no reliable answer in the DOM — a spinner
     * is a component's choice and an empty grid looks like a loading one — and
     * `isFetching()` is the router's and the hooks' own count of what is still
     * in flight (ADR-0034).
     */
    const queryClient = createQueryClient();
    const { container, unmount } = renderApp({
      initialPath: path,
      store: storeFor(path),
      queryClient,
      pseudo: true,
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

/**
 * The other locale arrives lazily, and arrives (`D20.9`, ADR-0046 §3 as
 * carried by ADR-0073 §5).
 *
 * Every suite above renders in `en`, which the harness hands to the instance
 * eagerly; nothing in the tier ever needed `lv` to resolve. The app's `lv` is
 * a different path entirely — one dynamic `import()` per namespace through
 * `resourcesToBackend`, a chunk the entry does not carry — and a path no test
 * walks is a path that can break unnoticed: a loader whose specifier no longer
 * matches the tree is a Latvian operator reading English with no error
 * anywhere (the failure mode `createI18n`'s `partialBundledLanguages` comment
 * names). So one screen switches, and the sentence asserted is a Latvian one
 * that only the lazy catalogue could have supplied.
 */
describe("the lazy catalogue", () => {
  it("renders an lv sentence after the switch, so the chunk resolved", async () => {
    const queryClient = createQueryClient();
    const { i18n, unmount } = renderApp({
      initialPath: "/",
      store: storeFor("/"),
      queryClient,
    });

    // The dashboard, in the eagerly bundled source language.
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(i18n.instance.hasResourceBundle("lv", "dashboard")).toBe(false);

    await i18n.changeLocale("lv");

    // Not in any eager catalogue: it is `dashboard:title` from
    // `locales/lv/dashboard.json`, which only the backend's `import()` loads.
    await screen.findByRole("heading", { name: "Vadības panelis" });
    expect(i18n.instance.hasResourceBundle("lv", "dashboard")).toBe(true);
    expect(document.documentElement.lang).toBe("lv-LV");

    unmount();
  });
});
