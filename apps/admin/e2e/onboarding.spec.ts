import { expect, test } from "./support/fixtures";

import { waitForRows } from "./support/app";
import { linkFromMail, waitForMail } from "./support/mail";

/**
 * Onboarding an operator, end to end and out of a real mailbox (`D18.11`;
 * [ADR-0071](../../../docs/adr/0071-mail-flows.md) §8, ADR-0052 §The browser
 * tier).
 *
 * **What only this tier can say.** The integration suite proves every wire
 * answer — the `invited` row, the single-use token, the `401` on a replay, the
 * `409` on a resend to somebody who has joined — and the component suite drives
 * the create surface and the `/onboarding` screen against MSW. Neither can put
 * a **message in a mailbox** and a **person in a browser** on either side of
 * it. That seam is the whole of §8: an admin leaves a password box empty, a
 * stranger reads a link in their own mail client, chooses a credential nobody
 * else ever holds, and arrives inside the panel.
 *
 * **The invitee gets a browser of their own**, because they must. The worker's
 * `app` page is signed in as the super admin for the length of the run
 * (`support/fixtures.ts`), and the accept **replaces** whatever session the
 * browser holds — walking the link in that page would sign the operator out of
 * the account every other spec in this file depends on, and ADR-0018's
 * rotation makes that unrecoverable inside one run.
 *
 * **It cleans up what it writes** (ADR-0052's data rules): the operator this
 * spec creates is deleted through the grid at the end, in the super admin's
 * own page. The message it left in Mailpit stays — a run's mail is evidence,
 * exactly as its rows would have been if the delete had failed.
 */

/** One address per run: staff addresses are unique and there is no soft delete. */
const INVITEE = {
  email: `e2e-invited-${String(Date.now())}@machxi.local`,
  firstName: "Ivy",
  lastName: "Invited",
  password: "E2eChosen!123",
} as const;

test("an operator is invited, follows the link, and chooses their own password", async ({
  app: page,
  browser,
  request,
}) => {
  /* ── the admin invites ────────────────────────────────────────────────── */

  await page.goto("/staff/new");

  /*
   * Scoped to the dialog, and it has to be: the grid underneath it carries a
   * "Filter by Email" trigger and a "Resize Email" handle, so an unscoped
   * `getByLabel("Email")` resolves to three controls. The surface is drawn
   * over the list rather than instead of it (ADR-0040), which is the whole
   * reason both are on the page at once.
   */
  const surface = page.getByRole("dialog");

  await expect(surface).toBeVisible();

  await surface.getByLabel("Email").fill(INVITEE.email);
  await surface.getByLabel("First name").fill(INVITEE.firstName);
  await surface.getByLabel("Last name").fill(INVITEE.lastName);

  /*
   * **The password box is left empty, and that is the request** (ADR-0071 §8).
   * There is no toggle and no second submit: the field itself carries the
   * choice, so what a browser proves here is that an untouched control really
   * does reach the API as an *omitted* key rather than as the `""` React holds
   * it at — the one translation the surface has to make and the one a jsdom
   * suite can only assert about a mock.
   */
  await expect(surface.getByLabel("Initial password")).toHaveValue("");

  await surface.getByRole("button", { name: "Create" }).click();

  await expect(page).toHaveURL(/\/staff$/);
  await waitForRows(page);

  /* ── the invitee reads their mail ─────────────────────────────────────── */

  /*
   * `request` rather than `page.request`, and the isolation is the point: the
   * browser context's jar holds the super admin's cookies and Mailpit is
   * another process on the same host, so a request made through the page would
   * carry a live CSRF cookie to a server that has no business seeing one.
   */
  const message = await waitForMail(request, INVITEE.email);
  const link = linkFromMail(message, "/onboarding");

  /*
   * And the link lands in **this** app. §8 says the onboarding link points at
   * the admin origin, and `MAIL_LINK_PATHS` is where the API decides it — a
   * customer-app link would leave the invitee on a screen that cannot help
   * them, which is the failure only an end-to-end walk notices.
   */
  expect(link).toContain(new URL(page.url()).origin);

  const invitee = await browser.newContext();
  const inviteePage = await invitee.newPage();

  try {
    await inviteePage.goto(link);

    /*
     * The fragment is struck before anything is typed (ADR-0057 §2, as §1
     * inherits it). In a browser this is the address bar, which is what a
     * screen-share, the session history and a third-party `Referer` all read —
     * jsdom can only ask the router.
     */
    await expect(inviteePage.getByLabel("Password")).toBeVisible();
    await expect(inviteePage).toHaveURL(/\/onboarding$/);

    await inviteePage.getByLabel("Password").fill(INVITEE.password);
    await inviteePage
      .getByRole("button", { name: "Save the password and sign in" })
      .click();

    /*
     * Landed **inside the panel**, which is §8's answer to "who signs in
     * first": the link is the only way this account has ever been reachable
     * and the person at the other end has just chosen its credential, so
     * unlike the recovery link next door this one ends in a session.
     */
    await expect(
      inviteePage.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();

    /*
     * And the password is the account's now, through the ordinary door: a
     * reload boots from the refresh cookie the accept placed (ADR-0029
     * §Opt-in), which is the half `D18.11`'s component suite cannot see
     * because jsdom has no jar.
     */
    await inviteePage.reload();
    await expect(
      inviteePage.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();
  } finally {
    await invitee.close();
  }

  /* ── and the run leaves nothing behind ────────────────────────────────── */

  await page.goto("/staff");
  await waitForRows(page);
  await page.getByRole("searchbox").fill(INVITEE.email);

  const row = page.getByRole("row").filter({ hasText: INVITEE.email });

  await expect(row).toBeVisible();

  await row.getByRole("button", { name: /^Row actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete" })
    .click();

  await expect(row).toBeHidden();
});
