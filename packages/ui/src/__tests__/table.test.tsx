import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";

/**
 * The container opt-out (ADR-0037 §One scroll container).
 *
 * The invariant the ADR decides is that exactly one element scrolls a grid and
 * the consumer owns it; the `container` prop is this package's half of that.
 * Both halves are asserted here, and the default is the one that matters most:
 * it keeps every consumer that never heard of ADR-0037 byte-compatible with the
 * generated component, which is what makes the local edit cheap to carry
 * through a future regenerate-and-diff (ADR-0031 §Consequences).
 */

const Fixture = ({ container }: { readonly container?: boolean }) => (
  <Table {...(container === undefined ? {} : { container })}>
    <TableHeader>
      <TableRow>
        <TableHead>Email</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>ada@example.com</TableCell>
      </TableRow>
    </TableBody>
  </Table>
);

describe("Table", () => {
  it("wraps the table in its own scroll container by default", () => {
    const { container } = render(<Fixture />);

    const wrapper = container.querySelector('[data-slot="table-container"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain("overflow-x-auto");
    expect(wrapper?.firstElementChild).toBe(screen.getByRole("table"));
  });

  it("renders the bare table when the consumer owns the scroll container", () => {
    const { container } = render(<Fixture container={false} />);

    expect(container.querySelector('[data-slot="table-container"]')).toBeNull();
    expect(container.firstElementChild).toBe(screen.getByRole("table"));
  });

  it("keeps the table's own markup and classes either way", () => {
    const withContainer = render(<Fixture />).container;
    const without = render(<Fixture container={false} />).container;

    const [a, b] = screen.getAllByRole("table");
    expect(a?.outerHTML).toBe(b?.outerHTML);
    expect(withContainer.textContent).toBe(without.textContent);
  });
});
