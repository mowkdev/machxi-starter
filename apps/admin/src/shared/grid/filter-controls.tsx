import { useT } from "@/shared/i18n";
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
 * The per-column filter controls (ADR-0035, re-housed by ADR-0039 at `D4.4`).
 *
 * One control per `kind`, each writing the `ColumnFilterValue` the engine's
 * `columnFilters` state holds and the URL is rebuilt from. A column gets a
 * control only where its config declares one, and a config declares one only
 * where `listQuerySchema` allow-lists the field and the operator — so the grid
 * cannot offer a filter the API would answer with a `VALIDATION_ERROR`.
 *
 * **What ADR-0039 changed is where these render and when they commit, not what
 * they are.** They used to sit in an always-visible second header row, each one
 * navigating as it changed; they now sit inside {@link ColumnFilterDialog},
 * editing a draft that Apply commits. So `onChange` here means "the draft
 * moved", the 300 ms debounce is gone (it belongs to `GridSearch`, which still
 * live-commits), and nothing in this file knows about the URL any more. That is
 * the ADR's "the code mostly moves house rather than being rewritten".
 *
 * Every control is a `@repo/ui` primitive. There is no seam between "grid UI"
 * and "app UI" because there is no second component library.
 */

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
  const { t } = useT("grid");

  switch (config.kind) {
    case "text":
      return (
        <Input
          aria-label={t("filter.trigger", { column: label })}
          placeholder={config.placeholder ?? t("filter.placeholder")}
          value={value?.kind === "text" ? value.term : ""}
          onChange={(event) => {
            const term = event.target.value;

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
          <SelectTrigger
            className="w-full"
            aria-label={t("filter.trigger", { column: label })}
          >
            <SelectValue placeholder={config.placeholder ?? t("filter.any")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>
              {config.placeholder ?? t("filter.any")}
            </SelectItem>
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

      /*
       * Two dates side by side, which is the shape that made the old row so
       * wide and the reason ADR-0039 opens where it does. In a dialog the width
       * is free.
       */
      return (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label={t("filter.from", { column: label })}
            value={range.from}
            onChange={(event) => {
              commit({ from: event.target.value, to: range.to });
            }}
          />
          <Input
            type="date"
            aria-label={t("filter.to", { column: label })}
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
          <Label htmlFor={id} className="font-normal">
            {config.label}
          </Label>
        </div>
      );
    }
  }
};
