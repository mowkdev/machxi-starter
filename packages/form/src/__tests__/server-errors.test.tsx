import { apiClientError } from "@repo/api-client";
import { emailSchema } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { AppFormProvider } from "../context";
import { AppFormError } from "../form-error";
import { applyServerErrors } from "../server-errors";
import { APP_ERRORS, messageForError } from "./support/render";

/**
 * Server-side failures landing where the operator will look (ADR-0035,
 * ADR-0036 §What must be covered, 2).
 *
 * The division of labour under test: **field-level errors belong to the form,
 * operation-level outcomes belong to toasts** — and, the case this is really
 * written against, **nothing vanishes**. A detail that matches no field still
 * has to be shown somewhere, or a form rejects a submit and explains itself to
 * nobody.
 */

interface Values {
  readonly email: string;
  readonly firstName: string;
}

const FIELDS = ["email", "firstName"] as const;

/*
 * The code map is `applyServerErrors`' required option (`D7.2`) — a default
 * would have been English, and a form whose fields are Latvian and whose
 * form-level failure is English is the drift the argument in
 * `server-errors.ts` exists to prevent.
 *
 * **A stand-in since `D22.3`**, when this suite moved out of the admin's door
 * (ADR-0077 §4). The admin's map read the admin's `errors` catalogue, and both
 * are that app's; the package's claim is where a failure *lands*, so the map
 * is the harness's `messageForError`, whose sentences no app ships. The
 * assertions that named the admin's words name the stand-in's.
 */

const Harness = ({
  error,
  codeFields,
}: {
  readonly error: unknown;
  readonly codeFields?: Record<string, string>;
}) => {
  const form = useForm<Values>({
    defaultValues: { email: "", firstName: "" },
  });

  return (
    <AppFormProvider fields={{}} variant="create" form={form}>
      <form aria-label="Harness">
        <AppFormError />
        <label htmlFor="email">Email</label>
        <Input id="email" {...form.register("email")} />
        <p data-slot="email-error">{form.formState.errors.email?.message}</p>
        <p data-slot="first-name-error">
          {form.formState.errors.firstName?.message}
        </p>
        <Button
          type="button"
          onClick={() => {
            applyServerErrors(error, form.setError, {
              fields: FIELDS,
              messageForError,
              ...(codeFields === undefined ? {} : { codeFields }),
            });
          }}
        >
          Fail
        </Button>
      </form>
    </AppFormProvider>
  );
};

const fail = (
  error: Parameters<typeof apiClientError>[0],
): ReturnType<typeof apiClientError> => apiClientError(error);

describe("applyServerErrors", () => {
  it("lands a validation detail on the field its path names", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        error={fail({
          status: 400,
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: [{ path: "email", message: "That address is not valid" }],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fail" }));

    expect(screen.getByText("That address is not valid")).toBeInTheDocument();
  });

  it("routes a domain code with no path to the field it is about", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        error={fail({
          status: 409,
          code: "STAFF_EMAIL_TAKEN",
          message: "A staff member with this email already exists",
        })}
        codeFields={{ STAFF_EMAIL_TAKEN: "email" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fail" }));

    /*
     * The API sends the conflict without `details` — it is about the request,
     * not about a zod issue — but the operator's question is "what do I
     * change?" and the answer is the email box. The message is the ADR-0034
     * map's, so the wording lives in one place.
     */
    expect(screen.getByText(APP_ERRORS.STAFF_EMAIL_TAKEN)).toBeInTheDocument();
  });

  it("shows a failure no field can claim at the top of the form", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        error={fail({
          status: 409,
          code: "STAFF_LAST_SUPER_ADMIN",
          message: "The last active super admin cannot be demoted or disabled",
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fail" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      APP_ERRORS.STAFF_LAST_SUPER_ADMIN,
    );
  });

  it("does not lose a detail naming a field this form does not render", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        error={fail({
          status: 400,
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: [{ path: "somethingElse", message: "Nope" }],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fail" }));

    // Falls through to the form-level message rather than vanishing, which is
    // the failure this function exists to prevent.
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("treats a non-envelope failure as a form-level one", async () => {
    const user = userEvent.setup();

    render(<Harness error={new TypeError("boom")} />);

    await user.click(screen.getByRole("button", { name: "Fail" }));

    expect(screen.getByRole("alert")).toHaveTextContent(APP_ERRORS.fallback);
  });

  it("reports whether anything landed on a field", () => {
    const setError = vi.fn();

    const landed = applyServerErrors(
      fail({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ path: "email", message: "Taken" }],
      }),
      setError,
      { fields: FIELDS, messageForError },
    );

    expect(landed).toBe(true);
    expect(setError).toHaveBeenCalledWith("email", {
      type: "server",
      message: "Taken",
    });

    expect(
      applyServerErrors(
        fail({ status: 403, code: "FORBIDDEN", message: "No" }),
        setError,
        { fields: FIELDS, messageForError },
      ),
    ).toBe(false);
  });

  it("keeps a per-member path so an array error lands on the member", () => {
    const setError = vi.fn();

    // RHF understands the rest of a dotted path itself, so `roles.0` lands on
    // that member rather than on the array.
    applyServerErrors(
      fail({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ path: "firstName.0", message: "Bad" }],
      }),
      setError,
      { fields: FIELDS, messageForError },
    );

    expect(setError).toHaveBeenCalledWith("firstName.0", {
      type: "server",
      message: "Bad",
    });
  });

  it("shows a field rule in the contract's own words, whichever side caught it", async () => {
    const user = userEvent.setup();
    const issue = emailSchema.safeParse("nope").error?.issues[0];

    if (issue === undefined) throw new Error("emailSchema should refuse this");

    render(
      <Harness
        error={fail({
          status: 400,
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          // What `toErrorDetails` sends: the zod issue's own message, copied
          // unchanged from the schema the API parsed with.
          details: [{ path: "email", message: issue.message }],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fail" }));

    /*
     * The D3.9 decision, pinned. A matched detail is rendered verbatim and is
     * *not* mapped through `ERROR_MESSAGES`, because a path-bearing detail is a
     * zod issue from `@repo/contracts` — the same schema `zodResolver` runs on
     * this form, so this is the sentence the client would have shown had it
     * caught the rule first. Codes are catalogued by ADR-0034's map; field
     * rules are catalogued by the schema that defines them, which is also where
     * localising them belongs.
     */
    expect(screen.getByText(issue.message)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("will not render a non-validation detail's words, whatever path it claims", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        error={fail({
          status: 503,
          code: "SERVICE_UNAVAILABLE",
          message: "Request failed",
          // Not a zod issue, so not a sentence anybody wrote for an operator.
          // Nothing in the API emits this shape today; the point of the check
          // is that the day something does, it cannot reach the screen.
          details: [{ path: "email", message: "pg: connection refused" }],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fail" }));

    expect(
      screen.queryByText("pg: connection refused"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      APP_ERRORS.SERVICE_UNAVAILABLE,
    );
  });
});

describe("AppFormError", () => {
  it("renders nothing until there is something to say", () => {
    render(<Harness error={new TypeError("boom")} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
