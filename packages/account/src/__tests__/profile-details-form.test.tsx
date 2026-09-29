import {
  updateProfileBody,
  updateStaffProfileBody,
  type UpdateProfileBody,
  type UpdateStaffProfileBody,
} from "@repo/contracts";
import { createAppFormInput } from "@repo/form";
import type { FieldConfigMap } from "@repo/resource";
import { useMutation } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  createProfileDetailsForm,
  type ProfileDetailsDeps,
  type ProfileNames,
} from "../profile/profile-details-form";

import { neverSettles, refusal } from "./support/profile.fixtures";
import { APP_COPY, renderAccount, useMessageForError } from "./support/render";

/**
 * A person's own names, certified where the form lives (`D22.2`, ADR-0077 §4;
 * ADR-0027, ADR-0035, ADR-0036).
 *
 * **Both doors' suites, collapsed to one.** The admin's and the customer's
 * asked the same questions of the same form on two segments, and every answer
 * that was the form's own is asked here once: what it is seeded with, when it
 * offers a submit, what it sends, what it holds afterwards, the lock while the
 * write is in flight, and where each kind of refusal lands.
 *
 * **The one thing the two populations differ in is a parameter**, and it is
 * asked as one: a staff member's names are `NOT NULL` and a customer's are
 * nullable (ADR-0017), so the form is mounted over each half of the contracts
 * pair with the `toFormValues` that half needs.
 *
 * What an app binds is passed, and is the test's own. The mutation is a
 * function this file holds rather than an entity over an endpoint, and the
 * field map is the harness's stand-in for an entity's. What is *not* asked
 * here is anything an entity decides — the endpoint, the outcome toast, the
 * principal in the session store, what else a write invalidates — and each
 * door keeps the cases that ask it, with the real ones.
 */

const fields = {
  firstName: { label: "app:fields.firstName", component: "input" },
  lastName: { label: "app:fields.lastName", component: "input" },
} as const satisfies FieldConfigMap;

const FormInput = createAppFormInput(fields);

interface Names<TName> {
  readonly id: string;
  readonly firstName: TName;
  readonly lastName: TName;
}

type StaffProfile = Names<string>;
type UserProfile = Names<string | null>;

const STAFF: StaffProfile = {
  id: "staff",
  firstName: "Ada",
  lastName: "Admin",
};

const NAMELESS: UserProfile = { id: "user", firstName: null, lastName: null };

/** The half of the contracts pair a door binds, and the conversion it needs. */
type Population<TProfile, TBody extends ProfileNames> = Pick<
  ProfileDetailsDeps<TProfile, TBody>,
  "schema" | "toFormValues"
>;

const staff: Population<StaffProfile, UpdateStaffProfileBody> = {
  schema: updateStaffProfileBody,
  toFormValues: (profile) => ({
    firstName: profile.firstName,
    lastName: profile.lastName,
  }),
};

const customer: Population<UserProfile, UpdateProfileBody> = {
  schema: updateProfileBody,
  // The customer door's conversion: a controlled input handed `null` is an
  // uncontrolled one, and one handed the string would say "null" out loud.
  toFormValues: (profile) => ({
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
  }),
};

/** The account after a write, as the endpoint would answer with it. */
const written = <TProfile extends Names<string | null>>(
  profile: TProfile,
  body: ProfileNames,
): TProfile => ({
  ...profile,
  ...(body.firstName === undefined ? {} : { firstName: body.firstName }),
  ...(body.lastName === undefined ? {} : { lastName: body.lastName }),
});

interface Mounted<TProfile, TBody> {
  readonly update?: (body: Partial<TBody>) => Promise<TProfile>;
  /** Passed as `useAfterSave` when given; the default is asked otherwise. */
  readonly afterSave?: () => void;
  /** What a refetch would bring back, behind a button the test presses. */
  readonly refetched?: TProfile;
}

const mount = <
  TProfile extends Names<string | null>,
  TBody extends ProfileNames,
>(
  population: Population<TProfile, TBody>,
  profile: TProfile,
  { update, afterSave, refetched }: Mounted<TProfile, TBody> = {},
) => {
  const user = userEvent.setup();
  const write = vi.fn<(body: Partial<TBody>) => Promise<TProfile>>(
    update ?? ((body) => Promise.resolve(written(profile, body))),
  );

  const useUpdateProfile = () => useMutation({ mutationFn: write });

  const ProfileDetailsForm = createProfileDetailsForm<TProfile, TBody>({
    ...population,
    fields,
    FormInput,
    useUpdateProfile,
    useMessageForError,
    ...(afterSave === undefined ? {} : { useAfterSave: () => afterSave }),
  });

  /*
   * The page above the form, reduced to what the form can see of it: a
   * `profile` prop that changes when a query refetches.
   */
  const Page = () => {
    const [current, setCurrent] = useState(profile);

    return (
      <>
        <ProfileDetailsForm profile={current} />
        {refetched === undefined ? null : (
          <button
            type="button"
            onClick={() => {
              setCurrent(refetched);
            }}
          >
            Refetch
          </button>
        )}
      </>
    );
  };

  return { ...renderAccount(<Page />), user, write };
};

const save = () => screen.getByRole("button", { name: "Save changes" });

describe("the details form", () => {
  it("renders the two names under the app's labels, seeded from the account", () => {
    mount(staff, STAFF);

    // The labels are the field map's, resolved from the app's catalogue.
    expect(screen.getByLabelText(APP_COPY.app.fields.firstName)).toHaveValue(
      "Ada",
    );
    expect(screen.getByLabelText(APP_COPY.app.fields.lastName)).toHaveValue(
      "Admin",
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  it("offers no submit until something has actually changed", async () => {
    const { user } = mount(staff, STAFF);

    expect(save()).toBeDisabled();

    await user.type(screen.getByLabelText("First name"), "x");

    expect(save()).toBeEnabled();
  });

  it("withdraws the submit when a change is typed back", async () => {
    const { user } = mount(staff, STAFF);

    await user.type(screen.getByLabelText("First name"), "x");
    await user.type(screen.getByLabelText("First name"), "{Backspace}");

    // Dirty is measured against the baseline, not against having been touched.
    expect(save()).toBeDisabled();
  });

  it("sends only the field that changed", async () => {
    const { user, write } = mount(staff, STAFF);

    await user.clear(screen.getByLabelText("First name"));
    await user.type(screen.getByLabelText("First name"), "Adaline");
    await user.click(save());

    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
    });

    // Pruned to `dirtyFields`, so the untouched last name is not re-sent — a
    // re-send would overwrite whatever somebody else changed in the meantime,
    // and it is what makes the contract's "at least one field" mean an edit.
    expect(write.mock.calls[0]?.[0]).toEqual({ firstName: "Adaline" });
  });

  it("sends both names when both changed", async () => {
    const { user, write } = mount(staff, STAFF);

    await user.type(screen.getByLabelText("First name"), "x");
    await user.type(screen.getByLabelText("Last name"), "y");
    await user.click(save());

    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
    });
    expect(write.mock.calls[0]?.[0]).toEqual({
      firstName: "Adax",
      lastName: "Adminy",
    });
  });

  it("goes clean again on what was saved", async () => {
    const { user } = mount(staff, STAFF);

    await user.type(screen.getByLabelText("Last name"), "s");
    await user.click(save());

    // The saved values are the new baseline: nothing left to submit.
    await waitFor(() => {
      expect(save()).toBeDisabled();
    });
    expect(screen.getByLabelText("Last name")).toHaveValue("Admins");

    // And it is the *saved* name that dirt is now measured against, not the
    // one the form was mounted with.
    await user.type(screen.getByLabelText("Last name"), "!");

    expect(save()).toBeEnabled();

    await user.type(screen.getByLabelText("Last name"), "{Backspace}");

    expect(save()).toBeDisabled();
  });

  it("sends only what changed since the last save", async () => {
    const { user, write } = mount(staff, STAFF);

    await user.type(screen.getByLabelText("Last name"), "s");
    await user.click(save());

    await waitFor(() => {
      expect(save()).toBeDisabled();
    });

    await user.type(screen.getByLabelText("First name"), "x");
    await user.click(save());

    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(2);
    });
    expect(write.mock.calls[1]?.[0]).toEqual({ firstName: "Adax" });
  });

  it("takes a refetch into the untouched box and leaves the touched one alone", async () => {
    const { user } = mount(staff, STAFF, {
      refetched: { ...STAFF, firstName: "Augusta", lastName: "Byron" },
    });

    await user.type(screen.getByLabelText("First name"), "x");
    await user.click(screen.getByRole("button", { name: "Refetch" }));

    /*
     * `values` + `keepDirtyValues`: a refetch that lands while somebody is
     * typing corrects what they have not touched and does not take the rest
     * out from under them.
     */
    await waitFor(() => {
      expect(screen.getByLabelText("Last name")).toHaveValue("Byron");
    });
    expect(screen.getByLabelText("First name")).toHaveValue("Adax");
  });

  it("locks every field while the request is in flight", async () => {
    const { user } = mount(staff, STAFF, { update: () => neverSettles() });

    await user.type(screen.getByLabelText("First name"), "x");
    await user.click(save());

    /*
     * The `fieldset disabled aria-busy` half of ADR-0035's submit lock — the
     * half this form assembles by hand because it is not in a dialog.
     * Asserted on the controls rather than on the fieldset, because what
     * matters is that nobody can type into them or submit twice.
     */
    await waitFor(() => {
      expect(screen.getByLabelText("First name")).toBeDisabled();
    });
    expect(screen.getByLabelText("Last name")).toBeDisabled();
    // Named with its spinner while it waits, and not to be pressed twice.
    expect(screen.getByRole("button", { name: /Save changes/ })).toBeDisabled();
  });

  it("refuses an emptied name before anything is sent", async () => {
    const { user, write } = mount(staff, STAFF);

    await user.clear(screen.getByLabelText("First name"));
    await user.click(save());

    // The contract's own rule, caught by the client because the client
    // validates with the schema the server validates with (ADR-0011).
    await waitFor(() => {
      expect(screen.getByLabelText("First name")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    expect(screen.getByLabelText("Last name")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("lands a server refusal on the field it names", async () => {
    const { user } = mount(staff, STAFF, {
      update: () =>
        Promise.reject(
          refusal(400, "VALIDATION_ERROR", [
            { path: "firstName", message: "Refused by the server" },
          ]),
        ),
    });

    await user.type(screen.getByLabelText("First name"), "x");
    await user.click(save());

    /*
     * ADR-0013 puts a zod issue's field path in `details`, and
     * `applyServerErrors` is entirely about where those paths land: beside
     * the box. The values passed the client's own parse, so the schema has
     * nothing to say about the path and the wire's sentence is what answers
     * (ADR-0046 §6).
     */
    expect(
      await screen.findByText("Refused by the server"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Last name")).not.toHaveAttribute(
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
      failure: refusal(403, "FORBIDDEN"),
      sentence: APP_COPY.errors.fallback,
    },
    {
      name: "a validation detail naming a field this form does not render",
      failure: refusal(400, "VALIDATION_ERROR", [
        { path: "email", message: "Refused by the server" },
      ]),
      sentence: APP_COPY.errors.fallback,
    },
  ])(
    "lands $name at form level, in the code map's words",
    async ({ failure, sentence }) => {
      const { user } = mount(staff, STAFF, {
        update: () => Promise.reject(failure),
      });

      await user.type(screen.getByLabelText("First name"), "x");
      await user.click(save());

      /*
       * Every path ends somewhere visible (ADR-0035): what no box can claim
       * is said at the foot of the form, in the app's code map's words and
       * never in the API's developer-facing ones.
       */
      expect(await screen.findByText(sentence)).toBeInTheDocument();
      expect(screen.getByLabelText("First name")).not.toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(
        screen.queryByText(/^wire: |^Refused by the server$/),
      ).not.toBeInTheDocument();

      // Still what was typed, and still submittable: a refusal is not a save.
      expect(screen.getByLabelText("First name")).toHaveValue("Adax");
      expect(save()).toBeEnabled();
    },
  );

  it("says what else went stale after a save", async () => {
    const afterSave = vi.fn();
    const { user, write } = mount(staff, STAFF, { afterSave });

    await user.type(screen.getByLabelText("First name"), "x");

    expect(afterSave).not.toHaveBeenCalled();

    await user.click(save());

    /*
     * `useAfterSave` is where an app says what else this write made stale
     * (ADR-0077 §2) — in the admin, the names on the operator's own
     * `/admin/staff` row. Once per write, and only once there was one.
     */
    await waitFor(() => {
      expect(afterSave).toHaveBeenCalledTimes(1);
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("says nothing went stale when the save is refused", async () => {
    const afterSave = vi.fn();
    const { user } = mount(staff, STAFF, {
      afterSave,
      update: () => Promise.reject(refusal(429, "RATE_LIMITED")),
    });

    await user.type(screen.getByLabelText("First name"), "x");
    await user.click(save());

    await screen.findByText(APP_COPY.errors.RATE_LIMITED);

    // Nothing was written, so nothing is stale: an invalidation here would be
    // a refetch of rows a refused request never touched.
    expect(afterSave).not.toHaveBeenCalled();
  });
});

describe("the details form over nullable names", () => {
  it("shows an empty box rather than the word null for a nameless account", () => {
    /*
     * The live branch the user segment has and the staff one does not:
     * `users` names are nullable (ADR-0017), so a customer created without
     * one is a real row. What the boxes hold is what `toFormValues` answered.
     */
    mount(customer, NAMELESS);

    expect(screen.getByLabelText("First name")).toHaveValue("");
    expect(screen.getByLabelText("Last name")).toHaveValue("");
    expect(save()).toBeDisabled();
  });

  it("saves a nameless account once both names are given", async () => {
    const { user, write } = mount(customer, NAMELESS);

    await user.type(screen.getByLabelText("First name"), "Cara");
    await user.type(screen.getByLabelText("Last name"), "Customer");
    await user.click(save());

    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
    });
    expect(write.mock.calls[0]?.[0]).toEqual({
      firstName: "Cara",
      lastName: "Customer",
    });

    await waitFor(() => {
      expect(save()).toBeDisabled();
    });
  });
});
