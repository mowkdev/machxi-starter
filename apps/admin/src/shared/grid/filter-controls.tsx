import { useEffect, useState, type ComponentProps } from "react";

import { resolveOptions } from "@/shared/resource/config";
import type { FilterControlConfig } from "@/shared/resource/types";
import {
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";

import type { ColumnFilterValue } from "./column-filters";

/**
 * The per-column filter controls (ADR-0035).
 *
 * One control per `kind`, each writing the `ColumnFilterValue` the engine's
 * `columnFilters` state holds and the URL is rebuilt from. A column gets a
 * control only where its config declares one, and a config declares one only
 * where `listQuerySchema` allow-lists the field and the operator — so the grid
 * cannot offer a filter the API would answer with a `VALIDATION_ERROR`.
 *
 * Every control is a `@repo/ui` primitive. There is no seam between "grid UI"
 * and "app UI" because there is no second component library.
 */

const DEBOUNCE_MS = 300;

/**
 * A text box that navigates when the operator stops typing.
 *
 * Undebounced, every keystroke would be a navigation, a new query key and a
 * request — five for `ada@x`, four of them already stale on arrival. Local
 * state holds what is typed; the effect below re-syncs it when the value
 * changes from outside (the back button, a pasted link), which is the case a
 * plain `defaultValue` gets wrong.
 */
const DebouncedInput = ({
  value,
  onCommit,
  ...props
}: {
  readonly value: string;
  readonly onCommit: (next: string) => void;
} & Omit<ComponentProps<typeof Input>, "value" | "onChange">) => {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);

  /*
   * Re-syncing the draft when the value changes from outside — the back button,
   * a pasted link — adjusted **during render** rather than in an effect.
   *
   * This is React's own documented pattern for "a prop changed and some state
   * has to follow it": the component re-renders immediately with the new value
   * and nothing in between is ever painted, where an effect would render the
   * stale draft first and then render again. `set-state-in-effect` flags the
   * effect version for exactly that reason.
   */
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return;

    const timer = setTimeout(() => {
      onCommit(draft);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
    // `onCommit` is re-created per render by every caller; including it would
    // restart the timer on each keystroke's re-render and never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, value]);

  return (
    <Input
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      {...props}
    />
  );
};

/**
 * The sentinel a `Select` uses for "no filter".
 *
 * Radix's `Select.Item` refuses an empty string value — it reserves it for the
 * placeholder — so "any" needs a value of its own rather than `""`.
 */
const ANY = "__any__";

export interface FilterControlProps {
  readonly field: string;
  readonly label: string;
  readonly config: FilterControlConfig;
  readonly value: ColumnFilterValue | undefined;
  readonly onChange: (next: ColumnFilterValue | undefined) => void;
}

export const FilterControl = ({
  field,
  label,
  config,
  value,
  onChange,
}: FilterControlProps) => {
  switch (config.kind) {
    case "text":
      return (
        <DebouncedInput
          aria-label={`Filter by ${label}`}
          placeholder={config.placeholder ?? "Filter…"}
          className="h-8"
          value={value?.kind === "text" ? value.term : ""}
          onCommit={(term) => {
            onChange(term === "" ? undefined : { kind: "text", term });
          }}
        />
      );

    case "enum": {
      const options = resolveOptions(config.options);
      const selected = value?.kind === "enum" ? (value.values[0] ?? ANY) : ANY;

      return (
        <Select
          value={selected}
          onValueChange={(next) => {
            onChange(
              next === ANY ? undefined : { kind: "enum", values: [next] },
            );
          }}
        >
          <SelectTrigger className="h-8" aria-label={`Filter by ${label}`}>
            <SelectValue placeholder={config.placeholder ?? "Any"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{config.placeholder ?? "Any"}</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case "dateRange": {
      const range =
        value?.kind === "dateRange" ? value : { from: "", to: "" as string };

      const commit = (next: { from: string; to: string }) => {
        onChange(
          next.from === "" && next.to === ""
            ? undefined
            : { kind: "dateRange", ...next },
        );
      };

      return (
        <div className="flex items-center gap-1">
          <Input
            type="date"
            className="h-8"
            aria-label={`${label} from`}
            value={range.from}
            onChange={(event) => {
              commit({ from: event.target.value, to: range.to });
            }}
          />
          <Input
            type="date"
            className="h-8"
            aria-label={`${label} to`}
            value={range.to}
            onChange={(event) => {
              commit({ from: range.from, to: event.target.value });
            }}
          />
        </div>
      );
    }

    case "presence": {
      const id = `filter-${field}`;

      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={value?.kind === "presence" && value.on}
            onCheckedChange={(checked) => {
              onChange(
                checked === true ? { kind: "presence", on: true } : undefined,
              );
            }}
          />
          <Label htmlFor={id} className="text-xs font-normal">
            {config.label}
          </Label>
        </div>
      );
    }
  }
};

/**
 * The toolbar's free-text search — ADR-0014's `q`, where the endpoint declares
 * itself searchable.
 *
 * It is not a column filter: `q` searches whatever columns the *endpoint* says
 * it does, which is a property of the API rather than of any one column, so it
 * lives above the table rather than under a header.
 */
export const GridSearch = ({
  value,
  onCommit,
}: {
  readonly value: string;
  readonly onCommit: (next: string) => void;
}) => (
  <DebouncedInput
    type="search"
    aria-label="Search"
    placeholder="Search…"
    className="h-8 max-w-xs"
    value={value}
    onCommit={onCommit}
  />
);
