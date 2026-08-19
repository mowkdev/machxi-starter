import { ERROR_CODES } from "@repo/contracts";
import {
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { apiClientError } from "@/shared/api/api-error";
import {
  ERROR_MESSAGES,
  messageForError,
} from "@/shared/notifications/messages";
import { Toaster } from "@/shared/ui";

import { createQueryClient } from "../providers/query-client";

/**
 * The notification policy (ADR-0034 §Notifications).
 *
 * Asserted **once, at the global handler**, which is the entire point of
 * putting the behaviour there: one test stands in for a per-mutation assertion
 * in every feature, and adding a mutation cannot forget the convention because
 * no mutation implements it.
 */

const wrap = (ui: ReactNode) => {
  const queryClient = createQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  );
};

const Trigger = ({
  run,
  meta,
}: {
  run: () => Promise<unknown>;
  meta?: { success?: string; errorToast?: boolean };
}) => {
  const mutation = useMutation({ mutationFn: run, ...(meta ? { meta } : {}) });

  return (
    <button
      onClick={() => {
        mutation.mutate();
      }}
      type="button"
    >
      Run
    </button>
  );
};

describe("the error message map", () => {
  it("covers every code in the contracts union", () => {
    // `Record<ErrorCode, string>` already makes a gap a build failure; this is
    // the runtime half of the same claim, and it catches a key that was typed
    // but left empty.
    for (const code of ERROR_CODES) {
      expect(ERROR_MESSAGES[code], code).toBeTruthy();
    }
  });

  it("falls back for a code this bundle has never heard of", () => {
    // An older bundle against a newer API is what contracts tells clients to
    // degrade on, so this path is reachable rather than defensive.
    const unknown = apiClientError({
      status: 400,
      code: "SOMETHING_NEW" as never,
      message: "developer-facing",
    });

    expect(messageForError(unknown)).toBe("Something went wrong. Try again.");
    // The API's own message is developer-facing (ADR-0013) and never shown.
    expect(messageForError(unknown)).not.toContain("developer-facing");
  });
});

describe("mutation notifications", () => {
  it("toasts what the mutation declared, with no call-site toast()", async () => {
    const user = userEvent.setup();

    wrap(
      <Trigger
        meta={{ success: "The staff member was created." }}
        run={() => Promise.resolve("ok")}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(
      await screen.findByText("The staff member was created."),
    ).toBeInTheDocument();
  });

  it("says nothing on success when the mutation declared nothing", async () => {
    const user = userEvent.setup();

    wrap(<Trigger run={() => Promise.resolve("ok")} />);
    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  it("maps a failure's code to its message without being asked", async () => {
    const user = userEvent.setup();

    wrap(
      <Trigger
        run={() =>
          Promise.reject(
            apiClientError({
              status: 409,
              code: "STAFF_LAST_SUPER_ADMIN",
              message: "developer-facing",
            }),
          )
        }
      />,
    );

    await user.click(screen.getByRole("button", { name: "Run" }));

    // Error toasting needs no declaration: the failure always matters.
    expect(
      await screen.findByText(ERROR_MESSAGES.STAFF_LAST_SUPER_ADMIN),
    ).toBeInTheDocument();
  });

  it("stays silent where a form will show the error inline", async () => {
    const user = userEvent.setup();

    wrap(
      <Trigger
        meta={{ errorToast: false }}
        run={() =>
          Promise.reject(
            apiClientError({
              status: 409,
              code: "STAFF_EMAIL_TAKEN",
              message: "developer-facing",
            }),
          )
        }
      />,
    );

    await user.click(screen.getByRole("button", { name: "Run" }));

    // The division of labour: field-level errors belong to the form,
    // operation-level outcomes belong to toasts.
    await waitFor(() => {
      expect(
        screen.queryByText(ERROR_MESSAGES.STAFF_EMAIL_TAKEN),
      ).not.toBeInTheDocument();
    });
  });
});

describe("query notifications", () => {
  const FailingQuery = () => {
    useQuery({
      queryKey: ["failing"],
      queryFn: () =>
        Promise.reject(
          apiClientError({ status: 500, code: "INTERNAL_ERROR", message: "x" }),
        ),
    });

    return <p>Loaded</p>;
  };

  const OptedInQuery = () => {
    useQuery({
      queryKey: ["opted-in"],
      meta: { errorToast: true },
      /*
       * A `403` rather than a `500`, and the difference is the retry rule doing
       * its job: a 5xx is retried twice before the query settles, so the toast
       * arrives after this assertion would have given up. A 4xx is an answer
       * and settles at once.
       */
      queryFn: () =>
        Promise.reject(
          apiClientError({ status: 403, code: "FORBIDDEN", message: "x" }),
        ),
    });

    return <p>Loaded</p>;
  };

  it("toasts when a query asks to", async () => {
    // The positive half. Without it the suite only proves the handler is
    // silent, which a handler that does nothing at all would also satisfy.
    wrap(<OptedInQuery />);

    expect(
      await screen.findByText(ERROR_MESSAGES.FORBIDDEN),
    ).toBeInTheDocument();
  });

  it("is quiet by default, unlike a mutation", async () => {
    wrap(<FailingQuery />);

    // A failed read has somewhere better to show itself, and a background
    // refetch failing should not interrupt an operator.
    await waitFor(() => {
      expect(screen.getByText("Loaded")).toBeInTheDocument();
    });
    expect(
      screen.queryByText(ERROR_MESSAGES.INTERNAL_ERROR),
    ).not.toBeInTheDocument();
  });
});
