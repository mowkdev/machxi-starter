import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAppRouter } from "@/app/providers/router";
import { createSessionStore } from "@/shared/api/session-store";
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
 * signed-in customer by name and draws their initials.
 *
 * Derived from the fixture rather than written out, so a renamed fixture cannot
 * quietly turn this suite into one that passes by allowing everything — and so
 * a *new* piece of copy can never land in the allow-list by accident, because
 * nothing but the fixture can get into it.
 */
const PRINCIPAL = userPrincipal();

const DATA: readonly string[] = [
  PRINCIPAL.id,
  PRINCIPAL.email,
  PRINCIPAL.firstName ?? "",
  PRINCIPAL.lastName ?? "",
  `${PRINCIPAL.firstName ?? ""} ${PRINCIPAL.lastName ?? ""}`,
  // The account control's monogram, which is data twice over: derived from
  // data, and rendered by a component that never sees a catalogue.
  `${(PRINCIPAL.firstName ?? "").slice(0, 1)}${(PRINCIPAL.lastName ?? "").slice(0, 1)}`.toUpperCase(),
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
 * renders under are installed in `beforeAll` (`src/test/setup.ts`). A router is
 * a data structure until something mounts it, so asking one for its own routes
 * costs nothing and touches no DOM.
 */
const ROUTE_PATHS: readonly string[] = [
  ...new Set(Object.keys(createAppRouter().routesByPath)),
]
  .filter((path) => !path.includes("$"))
  .sort();

/**
 * The session each address has to be visited **in** to see the page it names.
 *
 * `/login` is the one route a signed-in customer cannot reach: `_auth`'s mirror
 * guard redirects them home, so visiting it with a session would have walked
 * the home screen twice under the name of the sign-in screen — a page silently
 * uncovered while the suite reported two green. Every other address is behind
 * the `_dashboard` guard and needs the opposite.
 */
const storeFor = (path: string) =>
  path === "/login" ? createSessionStore() : authenticated();

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
  });

  it.each(ROUTE_PATHS)("leaves nothing unaccented at %s", async (path) => {
    const { container, unmount } = renderApp({
      initialPath: path,
      store: storeFor(path),
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

    expect(unaccented(document.body as HTMLElement)).toEqual([]);

    unmount();
  });
});
