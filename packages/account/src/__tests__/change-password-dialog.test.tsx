import type { SessionStore } from "@repo/api-client";
import { changePasswordBody, type ChangePasswordBody } from "@repo/contracts";
import { useMutation } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createChangePasswordDialog } from "../profile/change-password-dialog";

import { neverSettles, refusal } from "./support/profile.fixtures";
import {
  APP_COPY,
  authenticatedAs,
  principal,
  renderAccount,
  useMessageForError,
} from "./support/render";

/**
 * A person changing their own password, certified where the dialog lives
 * (`D22.2`, ADR-0077 §4; ADR-0027 §Self-service, ADR-0035, ADR-0036).
 *
 * **Both doors' suites, collapsed to one.** The admin's and the customer's
 * asked the same questions of the same dialog on two segments, and every
 * answer that was the dialog's own is asked here once: what the field map
 * declares against the contract, what the browser is told, what is refused
 * before a request exists, where each kind of refusal lands, the lock while
 * the write is in flight, and what is left in the form afterwards.
 *
 * **What an app binds is passed, and is the test's own.** The mutation is a
 * function this file holds rather than an entity over an endpoint, so "what
 * the dialog sent" is what it handed the dependency. The three sentences and
 * the code map are the harness's stand-ins, worded unlike either app's, so a
 * case that reads one can only have got it through the dependency. What is
 * *not* asked here is anything an entity decides — the endpoint, the outcome
 * toast, `gcTime: 0`, what else a write invalidates — and each door keeps the
 * cases that ask it, with the real ones.
 */

const CURRENT_PASSWORD = "DevPassword!123";
const NEW_PASSWORD = "AnotherPassword!456";

const COPY = {
  dialogDescription: "app:password.dialogDescription",
  currentPasswordDescription: "app:password.currentPasswordDescription",
  newPasswordDescription: "app:password.newPasswordDescription",
} as const;

type ChangePassword = (body: ChangePasswordBody) => Promise<unknown>;

const accepts: ChangePassword = () => Promise.resolve(undefined);

interface Mounted {
  /** The write, as the app's entity would have been asked for it. */
  readonly changePassword?: ChangePassword;
  /** Passed as `useAfterChange` when given; the default is asked otherwise. */
  readonly afterChange?: () => void;
  readonly store?: SessionStore;
}

const open = ({
  changePassword = accepts,
  afterChange,
  store,
}: Mounted = {}) => {
  const user = userEvent.setup();
  const write = vi.fn<ChangePassword>(changePassword);
  const onClose = vi.fn<() => void>();

  const useChangePassword = () => useMutation({ mutationFn: write });

  const { ChangePasswordDialog } = createChangePasswordDialog({
    copy: COPY,
    useChangePassword,
    useMessageForError,
    ...(afterChange === undefined ? {} : { useAfterChange: () => afterChange }),
  });

  const rendered = renderAccount(
    <ChangePasswordDialog onClose={onClose} />,
    store === undefined ? {} : { store },
  );

  return { ...rendered, user, write, onClose };
};

const submit = async (
  user: ReturnType<typeof userEvent.setup>,
  {
    current = CURRENT_PASSWORD,
    next = NEW_PASSWORD,
  }: { readonly current?: string; readonly next?: string } = {},
) => {
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.click(screen.getByRole("button", { name: "Change password" }));
};

describe("the change-password field map", () => {
  it("declares a field map the endpoint's own body accepts", () => {
    const { changePasswordFields } = createChangePasswordDialog({
      copy: COPY,
      useChangePassword: () => ({ mutateAsync: accepts, isPending: false }),
      useMessageForError,
    });

    /*
     * The contract test a field map owes when it is not a resource's
     * (ADR-0035, amended D3.7). `changePasswordBody` is a `strictObject`, so
     * one parse proves both directions: no unknown key, nothing required left
     * unrendered.
     */
    const parsed = changePasswordBody.safeParse(
      Object.fromEntries(
        Object.keys(changePasswordFields).map((name) => [
          name,
          name === "currentPassword" ? CURRENT_PASSWORD : NEW_PASSWORD,
        ]),
      ),
    );

    expect(Object.keys(changePasswordFields)).toEqual([
      "currentPassword",
      "newPassword",
    ]);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("takes its labels from the package and its descriptions from the app", () => {
    const { changePasswordFields } = createChangePasswordDialog({
      copy: COPY,
      useChangePassword: () => ({ mutateAsync: accepts, isPending: false }),
      useMessageForError,
    });

    /*
     * ADR-0077 §2's split, as data: the words both apps shared travel in this
     * package's namespace, and the three they word differently arrive as the
     * keys the door passed — never as a key of this package's own.
     */
    expect(changePasswordFields.currentPassword).toMatchObject({
      label: "accountClient:password.fields.currentPassword.label",
      description: COPY.currentPasswordDescription,
    });
    expect(changePasswordFields.newPassword).toMatchObject({
      label: "accountClient:password.fields.newPassword.label",
      description: COPY.newPasswordDescription,
    });
  });
});

describe("the change-password dialog", () => {
  it("says the three sentences the app passed, in the app's words", () => {
    open();

    expect(
      screen.getByRole("dialog", { name: "Change your password" }),
    ).toHaveAccessibleDescription(APP_COPY.app.password.dialogDescription);
    expect(
      screen.getByText(APP_COPY.app.password.currentPasswordDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByText(APP_COPY.app.password.newPasswordDescription),
    ).toBeInTheDocument();
  });

  it("tells the browser the truth about whose passwords these are", () => {
    open();

    /*
     * Both boxes hold the credential of the person typing, so the browser is
     * allowed to offer to save the new one — the inverse of the D3.7 finding,
     * where both boxes held a *subject's* credential and `new-password` would
     * have filed somebody else's password into the acting admin's vault.
     */
    expect(screen.getByLabelText("Current password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("anchors the two boxes to the signed-in address, out of sight", () => {
    open({
      store: authenticatedAs(principal({ email: "anchor@machxi.local" })),
    });

    /*
     * The identity a password manager keys the update on (D3.9 review): two
     * password boxes and no username give it nothing to match, so it updates
     * the wrong entry or files a duplicate. `hidden: true` because that is
     * what the box is — present for the browser, absent for a person and for
     * a screen reader — and it is the only text box in the dialog.
     */
    const anchor = screen.getByRole("textbox", { hidden: true });

    expect(anchor).toHaveValue("anchor@machxi.local");
    expect(anchor).toHaveAttribute("autocomplete", "username");
    expect(anchor).toHaveAttribute("readonly");
    expect(anchor).not.toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("leaves the anchor empty rather than absent with nobody signed in", () => {
    open();

    expect(screen.getByRole("textbox", { hidden: true })).toHaveValue("");
  });

  it("refuses a new password equal to the current one before anything is sent", async () => {
    const { user, write } = open();

    await submit(user, { next: CURRENT_PASSWORD });

    // `changePasswordBody`'s own refinement, rendered by the client because the
    // client validates with the schema the server validates with (ADR-0011),
    // and read out of `@repo/form`'s `form` namespace.
    expect(
      await screen.findByText(
        "The new password must differ from the current one",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses an empty current password before anything is sent", async () => {
    const { user, write, onClose } = open();

    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    expect(write).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("hands the write exactly the two values that were typed", async () => {
    const { user, write } = open();

    await submit(user);

    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
    });
    // The anchor is not a field: a `strictObject` would refuse the body.
    expect(write.mock.calls[0]?.[0]).toEqual({
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
  });

  it("lands a wrong current password on the box that has to change", async () => {
    const { user, onClose } = open({
      changePassword: () =>
        Promise.reject(refusal(403, "AUTH_CURRENT_PASSWORD_INVALID")),
    });

    await submit(user, { current: "NotMyPassword!1" });

    /*
     * `AUTH_CURRENT_PASSWORD_INVALID` is a `403` with no `details` — the
     * condition belongs to the credential check, not to a field (ADR-0027
     * §Contracts) — so it reaches the right box through `codeFields` rather
     * than through a path, and reads as the code map's sentence rather than as
     * the API's developer-facing message.
     */
    expect(
      await screen.findByText(APP_COPY.errors.AUTH_CURRENT_PASSWORD_INVALID),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("New password")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.queryByText("wire: AUTH_CURRENT_PASSWORD_INVALID"),
    ).not.toBeInTheDocument();
    // A refusal that closed the dialog would look exactly like a change.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lands a validation detail on the field it names", async () => {
    const { user } = open({
      changePassword: () =>
        Promise.reject(
          refusal(400, "VALIDATION_ERROR", [
            { path: "newPassword", message: "Refused by the server" },
          ]),
        ),
    });

    await submit(user);

    /*
     * ADR-0013 puts a zod issue's field path in `details`, and
     * `applyServerErrors` lands it beside the box. The values passed the
     * client's own parse, so the schema has nothing to say about the path and
     * the wire's sentence is what answers (ADR-0046 §6).
     */
    expect(
      await screen.findByText("Refused by the server"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Current password")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it.each([
    {
      name: "a code the map has a sentence for",
      failure: refusal(429, "RATE_LIMITED"),
      sentence: APP_COPY.errors.RATE_LIMITED,
    },
    {
      name: "a code the map has none for",
      failure: refusal(403, "AUTH_IMPERSONATION_REFUSED"),
      sentence: APP_COPY.errors.fallback,
    },
    {
      name: "a failure that is not the client's at all",
      failure: new Error("boom"),
      sentence: APP_COPY.errors.fallback,
    },
  ])(
    "lands $name at form level, in the code map's words",
    async ({ failure, sentence }) => {
      const { user, onClose } = open({
        changePassword: () => Promise.reject(failure),
      });

      await submit(user);

      /*
       * At form level rather than on a box, because the refusal is about the
       * request rather than about anything that was typed — there is no
       * `codeFields` row for it and there should not be one. **Nothing in
       * this dialog knows what the code means**: the app's map answers, and
       * the API's `error.message` is never what a person reads (ADR-0013,
       * ADR-0046 §2).
       */
      expect(await screen.findByText(sentence)).toBeInTheDocument();
      expect(screen.getByLabelText("Current password")).not.toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.getByLabelText("New password")).not.toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.queryByText(/^wire: |^boom$/)).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it("locks the dialog while the request is in flight", async () => {
    const { user, onClose } = open({ changePassword: () => neverSettles() });

    await submit(user);

    /*
     * ADR-0048 §4's `dismissible={!isPending}`: a form that locks its fields
     * and then lets you close the window has not locked anything, so the shell
     * withholds `onOpenChange`, Escape and the corner button rather than
     * offering a close it would refuse.
     */
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeDisabled();
    });
    expect(screen.getByLabelText("New password")).toBeDisabled();

    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape while nothing is in flight", async () => {
    const { user, onClose } = open();

    // The other half of the lock above: what it withholds is otherwise there.
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes once the change has landed", async () => {
    const { user, onClose } = open();

    await submit(user);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("holds neither password once the change has landed", async () => {
    // An `onClose` that closes nothing, which is the case the reset is for.
    const { user, onClose } = open();

    await submit(user);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    /*
     * `form.reset()` before `onClose`, so the plaintext is gone from the form
     * state whether or not React gets around to unmounting the dialog. This
     * harness's `onClose` is a spy and unmounts nothing, so the dialog is
     * still on screen and what its boxes hold can be read.
     */
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toHaveValue("");
    });
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });

  it("keeps what was typed when the change is refused", async () => {
    const { user } = open({
      changePassword: () =>
        Promise.reject(refusal(403, "AUTH_CURRENT_PASSWORD_INVALID")),
    });

    await submit(user, { current: "NotMyPassword!1" });

    await screen.findByText(APP_COPY.errors.AUTH_CURRENT_PASSWORD_INVALID);

    // The reset is the success path's: a refusal leaves one box to retype.
    expect(screen.getByLabelText("New password")).toHaveValue(NEW_PASSWORD);
  });

  it("says what else went stale after the change, and before it closes", async () => {
    const order: string[] = [];
    const afterChange = vi.fn(() => {
      order.push("afterChange");
    });
    const { user, onClose } = open({ afterChange });

    onClose.mockImplementation(() => {
      order.push("onClose");
    });

    await submit(user);

    /*
     * `useAfterChange` is where an app says what else this write made stale
     * (ADR-0077 §2) — in the admin, the operator's own `/admin/staff` row.
     * Once, and ahead of `onClose`, so it is not left to a component that the
     * close may already have unmounted.
     */
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(afterChange).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["afterChange", "onClose"]);
  });

  it("says nothing went stale when the change is refused", async () => {
    const afterChange = vi.fn();
    const { user } = open({
      afterChange,
      changePassword: () =>
        Promise.reject(refusal(403, "AUTH_CURRENT_PASSWORD_INVALID")),
    });

    await submit(user, { current: "NotMyPassword!1" });

    await screen.findByText(APP_COPY.errors.AUTH_CURRENT_PASSWORD_INVALID);

    // Nothing was written, so nothing is stale: an invalidation here would be
    // a refetch of rows a refused request never touched.
    expect(afterChange).not.toHaveBeenCalled();
  });
});
