import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbList,
} from "@repo/ui/components/breadcrumb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@repo/ui/components/dialog";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@repo/ui/components/pagination";
import { Toaster } from "@repo/ui/components/sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@repo/ui/components/sheet";
import {
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@repo/ui/components/sidebar";
import {
  DEFAULT_UI_STRINGS,
  UiStringsProvider,
  useUiStrings,
  type UiStrings,
} from "@repo/ui/ui-strings";

/**
 * The design system's operator-read strings (ADR-0046 §12).
 *
 * Two claims are under test and the first one matters most: **with no provider
 * mounted, every primitive renders exactly what the shadcn CLI emitted.** That
 * is what makes the seam free for a consumer that has not localised — this
 * package's own suite, `apps/web`, and any app D11 has not written yet — and it
 * is the property a future regenerate-and-diff would otherwise quietly break.
 *
 * The second is that a mounted provider reaches all six files, including the
 * places that are not visible text: a `sr-only` span, an `aria-label`, a
 * `title` and two `<nav>` landmark names. Most of them exist only for a screen
 * reader, which is the audience ADR-0046 §Alternatives says a visual walk never
 * notices — so they are asserted by accessible name rather than by looking at
 * the page.
 *
 * Each primitive gets its own render on purpose. A modal `Dialog` marks the
 * rest of the document `aria-hidden`, so one tree holding all five would hide
 * four of them from every role query and prove nothing about them.
 */

/** Latvian, the same words `apps/admin`'s `common` catalogue carries. */
const TRANSLATED: UiStrings = {
  close: "Aizvērt",
  previous: "Iepriekšējā",
  next: "Nākamā",
  morePages: "Vairāk lappušu",
  more: "Vairāk",
  toggleSidebar: "Pārslēgt sānjoslu",
  sidebarTitle: "Sānjosla",
  sidebarDescription: "Rāda mobilo sānjoslu.",
  previousPage: "Iet uz iepriekšējo lappusi",
  nextPage: "Iet uz nākamo lappusi",
  pagination: "lappuses",
  breadcrumb: "navigācijas ceļš",
  notifications: "Paziņojumi",
  dismiss: "Aizvērt paziņojumu",
};

const dialogs: ReactElement = (
  <Dialog open>
    <DialogContent>
      <DialogTitle>A record</DialogTitle>
      <DialogDescription>Its detail.</DialogDescription>
      <DialogFooter showCloseButton />
    </DialogContent>
  </Dialog>
);

const sheets: ReactElement = (
  <Sheet open>
    <SheetContent>
      <SheetTitle>A record</SheetTitle>
      <SheetDescription>Its detail.</SheetDescription>
    </SheetContent>
  </Sheet>
);

const pager: ReactElement = (
  <Pagination>
    <PaginationContent>
      <PaginationItem>
        <PaginationPrevious />
      </PaginationItem>
      <PaginationItem>
        <PaginationEllipsis />
      </PaginationItem>
      <PaginationItem>
        <PaginationNext />
      </PaginationItem>
    </PaginationContent>
  </Pagination>
);

const crumbs: ReactElement = (
  <Breadcrumb>
    <BreadcrumbList>
      <BreadcrumbEllipsis />
    </BreadcrumbList>
  </Breadcrumb>
);

const rails: ReactElement = (
  <SidebarProvider>
    <SidebarTrigger />
    <SidebarRail />
  </SidebarProvider>
);

/**
 * The toast region and the mobile sheet header, which `D7.6` added (ADR-0046
 * §12): the first is on every screen of every consumer, the second is what a
 * screen reader below the `md` breakpoint is told the drawer is.
 */
const toasts: ReactElement = <Toaster />;

const renderPlain = (ui: ReactElement) => render(ui);

const renderTranslated = (ui: ReactElement) =>
  render(<UiStringsProvider strings={TRANSLATED}>{ui}</UiStringsProvider>);

describe("the design system with no UiStringsProvider mounted", () => {
  it("keeps the generated `Close` in the dialog's corner and its footer", () => {
    renderPlain(dialogs);

    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(2);
  });

  it("keeps the generated `Close` in the sheet", () => {
    renderPlain(sheets);

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("keeps the pager's three", () => {
    renderPlain(pager);

    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText("More pages")).toBeInTheDocument();
  });

  it("keeps the breadcrumb ellipsis's `More`", () => {
    renderPlain(crumbs);

    expect(screen.getByText("More")).toBeInTheDocument();
  });

  it("keeps `Toggle Sidebar` on both the trigger and the rail", () => {
    renderPlain(rails);

    expect(
      screen.getAllByRole("button", { name: "Toggle Sidebar" }),
    ).toHaveLength(2);
  });

  it("keeps the pager's and breadcrumb's landmark names and the pager's two aria-labels", () => {
    renderPlain(pager);

    /*
     * `Previous` is the visible label and `Go to previous page` is the
     * `aria-label`; they are two strings, and before `D7.6` only one of them
     * was injectable. The anchor carries no `href`, so it is queried by label
     * rather than by the `link` role it does not have.
     */
    expect(
      screen.getByRole("navigation", { name: DEFAULT_UI_STRINGS.pagination }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(DEFAULT_UI_STRINGS.previousPage),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(DEFAULT_UI_STRINGS.nextPage),
    ).toBeInTheDocument();

    renderPlain(crumbs);

    expect(
      screen.getByRole("navigation", { name: DEFAULT_UI_STRINGS.breadcrumb }),
    ).toBeInTheDocument();
  });

  it("keeps the toast region's `Notifications`", () => {
    renderPlain(toasts);

    // Sonner appends its own hotkey hint, so the name starts with the string
    // rather than equalling it.
    expect(
      screen.getByLabelText(new RegExp(`^${DEFAULT_UI_STRINGS.notifications}`)),
    ).toBeInTheDocument();
  });

  it("hands the defaults to a consumer that asks for them directly", () => {
    const Probe = () => <span>{useUiStrings().toggleSidebar}</span>;

    render(<Probe />);

    expect(screen.getByText(DEFAULT_UI_STRINGS.toggleSidebar)).toBeVisible();
  });
});

describe("the design system under a UiStringsProvider", () => {
  it("renames both of the dialog's closes", () => {
    renderTranslated(dialogs);

    expect(
      screen.getAllByRole("button", { name: TRANSLATED.close }),
    ).toHaveLength(2);
  });

  it("renames the sheet's close", () => {
    renderTranslated(sheets);

    expect(
      screen.getByRole("button", { name: TRANSLATED.close }),
    ).toBeInTheDocument();
  });

  it("renames the pager's three", () => {
    renderTranslated(pager);

    expect(screen.getByText(TRANSLATED.previous)).toBeInTheDocument();
    expect(screen.getByText(TRANSLATED.next)).toBeInTheDocument();
    expect(screen.getByText(TRANSLATED.morePages)).toBeInTheDocument();
  });

  it("renames the breadcrumb ellipsis", () => {
    renderTranslated(crumbs);

    expect(screen.getByText(TRANSLATED.more)).toBeInTheDocument();
  });

  it("renames the sidebar trigger's label and the rail's label and title", () => {
    renderTranslated(rails);

    const buttons = screen.getAllByRole("button", {
      name: TRANSLATED.toggleSidebar,
    });

    expect(buttons).toHaveLength(2);
    // The rail writes the same string twice — `aria-label` for the screen
    // reader and `title` for the pointer — and both are one key.
    expect(buttons[1]).toHaveAttribute("title", TRANSLATED.toggleSidebar);
  });

  it("renames the two landmarks and the pager's two aria-labels", () => {
    renderTranslated(pager);

    expect(
      screen.getByRole("navigation", { name: TRANSLATED.pagination }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(TRANSLATED.previousPage)).toBeInTheDocument();
    expect(screen.getByLabelText(TRANSLATED.nextPage)).toBeInTheDocument();

    renderTranslated(crumbs);

    expect(
      screen.getByRole("navigation", { name: TRANSLATED.breadcrumb }),
    ).toBeInTheDocument();
  });

  it("renames the toast region", () => {
    renderTranslated(toasts);

    expect(
      screen.getByLabelText(new RegExp(`^${TRANSLATED.notifications}`)),
    ).toBeInTheDocument();
  });

  it("keeps English for a key the app has not supplied", () => {
    render(
      <UiStringsProvider strings={{ close: TRANSLATED.close }}>
        {pager}
      </UiStringsProvider>,
    );

    // Partial is halfway, not broken (ADR-0046 §12).
    expect(screen.getByText(DEFAULT_UI_STRINGS.previous)).toBeInTheDocument();
  });

  it("follows a change in the strings without remounting anything", () => {
    const { rerender } = render(
      <UiStringsProvider strings={DEFAULT_UI_STRINGS}>
        {rails}
      </UiStringsProvider>,
    );

    const [trigger] = screen.getAllByRole("button", {
      name: DEFAULT_UI_STRINGS.toggleSidebar,
    });

    rerender(
      <UiStringsProvider strings={TRANSLATED}>{rails}</UiStringsProvider>,
    );

    /*
     * The same DOM node, renamed. This is the shape a locale switch takes in
     * the app — `app/providers/ui-strings.tsx` re-renders with new `t()` output
     * and nothing unmounts — and it is what would break if a primitive read its
     * copy once at mount.
     */
    expect(trigger).toHaveAccessibleName(TRANSLATED.toggleSidebar);
  });

  it("hands out the same value when only the object's identity changed", () => {
    const seen: UiStrings[] = [];

    const Probe = () => {
      seen.push(useUiStrings());

      return null;
    };

    const { rerender } = render(
      <UiStringsProvider strings={{ close: "Close" }}>
        <Probe />
      </UiStringsProvider>,
    );

    /*
     * A fresh object with identical contents, which is exactly what the app's
     * bridge hands over on every render: `{ close: t("common:ui.close"), … }`
     * is a new object each time. Memoising on the values rather than on the
     * object they arrive in is what keeps a context value stable through that,
     * and therefore what keeps every memoised consumer below it from
     * re-rendering for nothing (ADR-0046 §12).
     */
    rerender(
      <UiStringsProvider strings={{ close: "Close" }}>
        <Probe />
      </UiStringsProvider>,
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});
