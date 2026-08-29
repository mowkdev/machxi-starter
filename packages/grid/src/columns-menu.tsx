import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Columns3Icon,
  GripVerticalIcon,
} from "lucide-react";

import { useT } from "@repo/i18n";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Label } from "@repo/ui/components/label";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { Separator } from "@repo/ui/components/separator";
import { cn } from "@repo/ui/lib/utils";
import { useState } from "react";

/**
 * The Columns surface (ADR-0041, `D4.5`; drag-and-drop at `D10.3`).
 *
 * Show and hide, reorder, and reset — the two preferences a header edge cannot
 * express. Sizing has its own gesture on the header; these do not.
 *
 * **`D4.5` refused a drag-and-drop dependency and named the condition for
 * taking one**: "the day reordering frequency proves a list too slow is the day
 * that dependency gets argued for". ADR-0052 §Visible state is that argument,
 * made by the operator, and `@dnd-kit` is the answer to it — chosen for
 * keyboard operability, which is the property that lets the gesture be *added*
 * to this row rather than replace what was here.
 *
 * **The buttons stay.** A drag handle and two arrows for one column is
 * duplication of exactly the kind ADR-0039's chip suppression rejected and
 * ADR-0052 has now accepted twice: a pointer gesture is faster for a long move
 * and impossible to do precisely, arrows are exact and reachable by anyone who
 * cannot drag. The handle is on the left, where a grip is expected; the arrows
 * stay on the right, where they were.
 *
 * **A `Popover` holding a real list, not a `DropdownMenu`** — a `D4.5` decision
 * on a question ADR-0041 left to the implementation by writing only "menu". A
 * Radix menu treats each item as one actionable unit with a roving tabindex and
 * closes on activation; a row here is now *four* controls used in sequence, so
 * a menu would have to be talked out of both behaviours with `onSelect`
 * preventions and nested focus traps. A Popover is a plain container and the
 * row is ordinary DOM — which is also what lets `useSortable` attach to it.
 *
 * **Structural columns are absent, not disabled** (ADR-0041). The caller passes
 * only the movable ones, so the selection and row-actions columns cannot be
 * hidden or moved because they are not offered — no flag to forget, and no
 * disabled control that raises the question of why.
 */

export interface ColumnsMenuEntry {
  readonly id: string;
  /** The column's header, which is the word the operator sees on screen. */
  readonly label: string;
  readonly isVisible: boolean;
}

export interface ColumnsMenuProps {
  /** The movable columns, in their current render order. */
  readonly entries: readonly ColumnsMenuEntry[];
  readonly onToggle: (id: string, visible: boolean) => void;
  readonly onMove: (id: string, direction: -1 | 1) => void;
  /**
   * A drag landed: put `activeId` where `overId` currently is (`D10.3`).
   *
   * **Two ids rather than two indices**, which is what `@dnd-kit` reports and
   * also what survives the trip: this component renders the order it was
   * handed, and by the time the caller applies the move it is reading its own
   * preference state — where an index computed here could refer to a list that
   * has since changed. An id cannot drift.
   */
  readonly onReorder: (activeId: string, overId: string) => void;
  readonly onReset: () => void;
  /** Whether anything currently deviates from the config. */
  readonly isDirty: boolean;
}

/*
 * The sensors' options, at module scope, and **that is load-bearing rather
 * than tidy**.
 *
 * `useSensor` memoises its descriptor on the options object's identity, so an
 * inline literal builds a new descriptor — and `useSensors` a new array — on
 * every render. `DndContext` re-initialises its sensors when that array
 * changes, which means any re-render *during* a drag cancels the drag. This
 * component re-renders during one on purpose (see `isDragging` below), so an
 * inline literal here silently broke the keyboard gesture: the lift happened,
 * the arrow moved nothing, and no error was reported anywhere. Found by the
 * suite, which is the only place it could have been found.
 *
 * The 8px pointer distance is what keeps a *click* on the grip from being a
 * zero-length drag; the coordinate getter is what makes the keyboard path
 * exist at all (ADR-0052 §Alternatives).
 */
const POINTER_OPTIONS = { activationConstraint: { distance: 8 } } as const;

const KEYBOARD_OPTIONS = {
  coordinateGetter: sortableKeyboardCoordinates,
} as const;

/**
 * The last visible column cannot be hidden.
 *
 * A grid with no columns is not a preference, it is a blank rectangle where the
 * data was — and the one control that could undo it is inside this menu, which
 * is a worse place to discover the mistake than to prevent it.
 */
const isLastVisible = (
  entries: readonly ColumnsMenuEntry[],
  entry: ColumnsMenuEntry,
): boolean =>
  entry.isVisible && entries.filter((other) => other.isVisible).length === 1;

export const ColumnsMenu = ({
  entries,
  onToggle,
  onMove,
  onReorder,
  onReset,
  isDirty,
}: ColumnsMenuProps) => {
  const { t } = useT("grid");

  /*
   * Both sensors, and the keyboard one is the reason this dependency was
   * acceptable at all: `sortableKeyboardCoordinates` makes the handle a real
   * control — Space to lift, arrows to move, Space to drop — rather than a
   * pointer-only affordance that would have left the arrows carrying
   * accessibility alone (ADR-0052 §Alternatives, rejecting native HTML5 DnD
   * for that exact reason).
   *
   * Both options objects are module constants, for a reason worth reading
   * before touching them — see `POINTER_OPTIONS` above.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_OPTIONS),
  );

  /*
   * Whether a drag is in flight, and it exists for one reason: **Escape**.
   *
   * `@dnd-kit`'s own instructions tell the operator to press escape to cancel,
   * and its keyboard sensor listens on the document — but so does Radix's
   * dismiss layer, which was mounted first and therefore answers first. Without
   * this the advertised cancel gesture closes the whole menu, which is a worse
   * outcome than the drag it was undoing. `onEscapeKeyDown` below refuses the
   * dismissal exactly while a drag is up, and hands escape back to the sensor.
   */
  const [isDragging, setIsDragging] = useState(false);

  if (entries.length === 0) return null;

  const labelOf = (id: UniqueIdentifier): string =>
    entries.find((entry) => entry.id === String(id))?.label ?? String(id);

  const positionOf = (id: UniqueIdentifier): number =>
    entries.findIndex((entry) => entry.id === String(id)) + 1;

  /*
   * The live region's words (ADR-0046, `D10.3`).
   *
   * **`@dnd-kit` ships English announcements that interpolate the item's `id`**
   * — "Draggable item createdAt was dropped over droppable area email" — so a
   * menu that took the default would name a grip "Reorder Created" on screen
   * and announce it as `createdAt` to a screen reader, in every locale. That is
   * the surface ADR-0052 §Alternatives took this dependency *for*: native HTML5
   * DnD was rejected because it would leave the arrows carrying accessibility
   * alone, and untranslated id-bearing copy would have left them carrying it
   * anyway. Labels in, catalogue keys out.
   */
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t("columns.dnd.lifted", {
        column: labelOf(active.id),
        position: positionOf(active.id),
        total: entries.length,
      }),
    onDragOver: ({ active, over }) =>
      over === null
        ? undefined
        : t("columns.dnd.moved", {
            column: labelOf(active.id),
            position: positionOf(over.id),
            total: entries.length,
          }),
    onDragEnd: ({ active, over }) =>
      over === null
        ? t("columns.dnd.cancelled", {
            column: labelOf(active.id),
            position: positionOf(active.id),
            total: entries.length,
          })
        : t("columns.dnd.dropped", {
            column: labelOf(active.id),
            position: positionOf(over.id),
            total: entries.length,
          }),
    onDragCancel: ({ active }) =>
      t("columns.dnd.cancelled", {
        column: labelOf(active.id),
        position: positionOf(active.id),
        total: entries.length,
      }),
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    /*
     * A drop outside any row, or back onto the one it came from, is not a
     * reorder — and calling the caller with `active === over` would write a
     * preference identical to the one already stored, which is a persisted
     * write and a re-render for a gesture that did nothing.
     */
    setIsDragging(false);

    if (over === null || active.id === over.id) return;

    onReorder(String(active.id), String(over.id));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Columns3Icon aria-hidden />
          {t("columns.label")}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-64 p-2"
        onEscapeKeyDown={(event) => {
          // Escape belongs to the drag while one is up; the sensor cancels it,
          // and the menu stays open with the order it started with.
          if (isDragging) event.preventDefault();
        }}
      >
        <PopoverTitle className="px-2 py-1.5 text-sm font-medium">
          {t("columns.label")}
        </PopoverTitle>

        <DndContext
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable: t("columns.dnd.instructions"),
            },
          }}
          collisionDetection={closestCenter}
          /*
           * The list is a column, so a drag has one degree of freedom.
           * Unrestricted, a pointer drifting sideways carries the row out of
           * the popover's 16rem width and the collision detection starts
           * answering about nothing.
           */
          modifiers={[restrictToVerticalAxis]}
          sensors={sensors}
          onDragCancel={() => {
            setIsDragging(false);
          }}
          onDragEnd={handleDragEnd}
          onDragStart={() => {
            setIsDragging(true);
          }}
        >
          <SortableContext
            items={entries.map((entry) => entry.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col py-1">
              {entries.map((entry, index) => (
                <SortableColumnRow
                  key={entry.id}
                  entry={entry}
                  isFirst={index === 0}
                  isLast={index === entries.length - 1}
                  isOnlyVisible={isLastVisible(entries, entry)}
                  onMove={onMove}
                  onToggle={onToggle}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <Separator className="my-1" />

        {/*
         * Disabled while nothing deviates, because Reset then has nothing to
         * do and an enabled control that does nothing is the affordance
         * ADR-0038 spent a step removing from toolbars.
         */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          disabled={!isDirty}
          onClick={onReset}
        >
          {t("columns.reset")}
        </Button>
      </PopoverContent>
    </Popover>
  );
};

/**
 * One column's row: the grip, the checkbox, the label and the two arrows.
 *
 * Its own component because `useSortable` is a hook and the rows are a list —
 * the alternative is a hook call per iteration, which React forbids for the
 * reason this split fixes.
 */
const SortableColumnRow = ({
  entry,
  isFirst,
  isLast,
  isOnlyVisible,
  onToggle,
  onMove,
}: {
  readonly entry: ColumnsMenuEntry;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly isOnlyVisible: boolean;
  readonly onToggle: (id: string, visible: boolean) => void;
  readonly onMove: (id: string, direction: -1 | 1) => void;
}) => {
  const { t } = useT("grid");
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: entry.id,
    /*
     * `@dnd-kit`'s default is the English literal "draggable" (ADR-0046 §12's
     * problem, one layer down): every grip would announce itself in English
     * whatever the locale. It also says nothing useful — what this is, is a
     * column you can put somewhere else.
     */
    attributes: { roleDescription: t("columns.dnd.role") },
  });

  return (
    <div
      ref={setNodeRef}
      data-slot="columns-menu-row"
      className={cn(
        "flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-accent",
        // Lifted above its neighbours while it travels, or the rows it passes
        // paint over it.
        isDragging && "relative z-10 bg-accent shadow-sm",
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {/*
       * The grip carries the drag listeners, not the row: a row that was
       * itself draggable would start a drag from the checkbox and from the
       * label, and the label is what an operator clicks to toggle the column.
       *
       * `size-6` and named per column for the reason the arrows are — "Reorder"
       * twelve times over names nothing, and a handle a screen reader cannot
       * name is a control it cannot offer.
       */}
      <Button
        aria-label={t("columns.reorder", { column: entry.label })}
        className="size-6 cursor-grab text-muted-foreground active:cursor-grabbing"
        size="icon"
        variant="ghost"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon aria-hidden />
      </Button>

      <Checkbox
        id={`column-${entry.id}`}
        checked={entry.isVisible}
        disabled={isOnlyVisible}
        onCheckedChange={(checked) => {
          onToggle(entry.id, checked === true);
        }}
      />
      <Label
        htmlFor={`column-${entry.id}`}
        className="min-w-0 flex-1 truncate font-normal"
      >
        {entry.label}
      </Label>

      {/*
       * Named per column, not "Move up" twelve times over. The
       * role-and-name discipline is what keeps a test — and a screen
       * reader — from having to count rows to know which column a
       * button moves.
       */}
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={t("columns.moveUp", { column: entry.label })}
        disabled={isFirst}
        onClick={() => {
          onMove(entry.id, -1);
        }}
      >
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={t("columns.moveDown", { column: entry.label })}
        disabled={isLast}
        onClick={() => {
          onMove(entry.id, 1);
        }}
      >
        <ArrowDownIcon aria-hidden />
      </Button>
    </div>
  );
};
