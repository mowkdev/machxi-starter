import { z } from "zod";

/**
 * The grid preferences store (ADR-0041, `D4.5`).
 *
 * **The third state owner, and the whole of it is a boundary.** The URL owns
 * *view* state — what data is being looked at (`offset`, `limit`, `sort`,
 * `filters`, `q`), which is ADR-0034's decision and is untouched. This owns
 * *ergonomics* state — how this operator likes the grid arranged: column
 * sizing, order and visibility. The table owns nothing durable.
 *
 * The split is not tidiness. Ergonomics are personal rather than propositional:
 * two operators looking at the same view legitimately hold different
 * arrangements, and a shared link **must not impose the sender's column widths
 * on the receiver** — which is exactly what URL-held sizing would do, besides
 * bloating every link with state nobody meant to send. A view is a claim about
 * the dataset; a layout is a claim about a desk.
 *
 * ADR-0032 §Client state predicted this arrival by name: three categories —
 * server state in the query cache, session state in the ADR-0033 store,
 * everything else local or in the URL — and "a fourth category appearing is the
 * signal to write that ADR, not to reach for a store". This is the fourth
 * category, and ADR-0041 is the ADR that sentence mandated.
 *
 * **On ADR-0033, plainly.** This is the non-credential display state that
 * ADR's D3.1 amendment carves out, with the theme provider as the standing
 * precedent. An XSS that reads `machxi.admin.grid:staff:v1` learns which
 * columns an operator prefers wide. Nothing else may ever enter it: column
 * names and numbers only — never row data, never a filter value, never
 * anything typed into the grid.
 */

/**
 * The seam, and the seam is the point.
 *
 * D4 ships one implementation over `window.localStorage`. A server-backed
 * user-settings adapter slots in later **without touching the store or
 * `AppGrid`** — same three functions, same string key, same JSON value — and
 * that is the claim this design should be held to. It is also the test seam:
 * every assertion about this store runs against an in-memory implementation.
 */
export interface PreferenceStorage {
  readonly read: (key: string) => string | null;
  readonly write: (key: string, value: string) => void;
  readonly remove: (key: string) => void;
}

/** What one grid's arrangement is. Column ids and numbers, nothing else. */
export interface GridPreferences {
  /** Column id → px. Absent means "whatever the content needs". */
  readonly sizing: Readonly<Record<string, number>>;
  /** Every movable column, in render order. */
  readonly order: readonly string[];
  /** The movable columns currently hidden. */
  readonly hidden: readonly string[];
}

/**
 * What the config says, which is what "Reset to defaults" returns to.
 *
 * Only the **movable** columns: ADR-0038's selection column and the row-actions
 * column are structural, pinned first and last by construction, and never
 * appear here — so they cannot be hidden, reordered or stored, and no
 * validation is needed to keep them that way.
 */
export interface GridPreferenceDefaults {
  readonly order: readonly string[];
}

/**
 * The stored value, versioned in the key *and* in the payload.
 *
 * Client-only, and beside the store rather than in `@repo/contracts`: nothing
 * on the wire speaks this today. The day a user-settings API does, moving it
 * there is that deliverable's work, and the adapter plus this schema are the
 * whole contract it inherits.
 */
/**
 * Narrow enough to be a choice, wide enough to still be a column; and an upper
 * bound so a hand-edited entry cannot make one column the whole table.
 *
 * Both live here rather than beside the drag, because **the read path has to
 * agree with the write path**: `setColumnWidth` clamps, and a schema that
 * accepted anything finite and positive would let a stored `1` through — a
 * column an operator can see but cannot grab, reachable only through a Reset
 * that would undo their other columns too.
 */
export const MIN_COLUMN_WIDTH = 64;
export const MAX_COLUMN_WIDTH = 2_000;

export const clampColumnWidth = (width: number): number =>
  Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));

/**
 * A column id, bounded — it is a config key, not free text.
 *
 * The bound is what stops a crafted entry turning the Columns menu into
 * something that cannot be opened, which matters because "Reset to defaults"
 * lives inside it.
 */
const columnId = z.string().min(1).max(64);

/** More columns than any grid this vocabulary can describe will ever have. */
const MAX_COLUMNS = 200;

const storedPreferences = z.object({
  v: z.literal(1),
  sizing: z.record(
    columnId,
    z.number().int().min(MIN_COLUMN_WIDTH).max(MAX_COLUMN_WIDTH),
  ),
  order: z.array(columnId).max(MAX_COLUMNS),
  hidden: z.array(columnId).max(MAX_COLUMNS),
});

export const gridStorageKey = (gridId: string): string =>
  `machxi.admin.grid:${gridId}:v1`;

/**
 * `window.localStorage`, best-effort in both directions.
 *
 * Every call is guarded, and that is a decision rather than defensive habit:
 * `localStorage` throws on quota and is absent or poisoned in some private
 * modes, and **preferences failing to persist must degrade to preferences not
 * persisting, never to a broken grid.** A grid is a work surface; a storage
 * quota is not a reason an operator cannot see their data.
 */
export const createLocalStorageAdapter = (): PreferenceStorage => ({
  read: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* see above: not persisting is an acceptable outcome */
    }
  },
  remove: (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* see above */
    }
  },
});

/** The adapter for a grid with no id to persist under, and for tests. */
export const createMemoryStorage = (): PreferenceStorage => {
  const entries = new Map<string, string>();

  return {
    read: (key) => entries.get(key) ?? null,
    write: (key, value) => {
      entries.set(key, value);
    },
    remove: (key) => {
      entries.delete(key);
    },
  };
};

/**
 * Stored ids against the config as it is *now*.
 *
 * **A config change must never strand an operator on a stale layout.** Ids the
 * config no longer declares are dropped from all three slices; columns added
 * since the entry was written are appended in declaration order at their
 * defaults. So renaming a column reverts it to default, adding one makes it
 * appear, and nobody clears storage to recover a grid — there is no migration
 * to write, ever, because the load path absorbs the drift.
 */
export const reconcile = (
  stored: GridPreferences,
  defaults: GridPreferenceDefaults,
): GridPreferences => {
  const known = new Set(defaults.order);
  /*
   * De-duplicated as well as filtered. The allow-list alone lets a repeated id
   * through, and a repeat is not a harmless oddity: the Columns menu keys its
   * rows by id, so two rows would share a React key and a `<label for>`, one
   * checkbox would appear to toggle both, and `indexOf` would move only the
   * first — a menu that misbehaves in a way an operator cannot explain or
   * escape except through Reset.
   */
  const kept = [...new Set(stored.order.filter((id) => known.has(id)))];
  const keptIds = new Set(kept);

  return {
    order: [...kept, ...defaults.order.filter((id) => !keptIds.has(id))],
    hidden: [...new Set(stored.hidden.filter((id) => known.has(id)))],
    sizing: Object.fromEntries(
      Object.entries(stored.sizing).filter(([id]) => known.has(id)),
    ),
  };
};

export const createGridPreferences = ({
  gridId,
  storage,
  defaults,
}: {
  /** One entry per grid. Defaults to `ResourceConfig.name` at the call site. */
  readonly gridId: string;
  readonly storage: PreferenceStorage;
  readonly defaults: GridPreferenceDefaults;
}) => {
  const key = gridStorageKey(gridId);
  const listeners = new Set<() => void>();

  const fromDefaults = (): GridPreferences => ({
    sizing: {},
    order: [...defaults.order],
    hidden: [],
  });

  /**
   * Read, validate, reconcile — and **discard silently on any failure**.
   *
   * A parse failure, an unknown version, hand-edited garbage: all of it falls
   * back to config defaults without a toast, a log or an exception, because
   * **corrupt preferences must never break a grid**. There is no operator
   * action that a message here would prompt, and the grid an operator gets is
   * the one the config describes — which is the same grid they had before they
   * ever touched a column.
   */
  const load = (): GridPreferences => {
    try {
      const raw = storage.read(key);

      if (raw === null) return fromDefaults();

      const parsed = storedPreferences.safeParse(JSON.parse(raw));

      return parsed.success ? reconcile(parsed.data, defaults) : fromDefaults();
    } catch {
      /*
       * The `read` is inside the guard as well as the parse, so the promise
       * holds for *any* adapter rather than only for well-behaved ones. The
       * shipped `localStorage` adapter swallows its own failures; a future
       * server-backed one might not, and "corrupt preferences must never break
       * a grid" should not become "unless somebody wrote a strict adapter".
       */
      return fromDefaults();
    }
  };

  /** Persistence is best-effort; the in-memory value is not. */
  const persist = (write: () => void) => {
    try {
      write();
    } catch {
      /* not persisting is an acceptable outcome; a broken grid is not */
    }
  };

  let preferences = load();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    /*
     * Returns the held object, not a fresh one. `useSyncExternalStore`
     * re-renders whenever the snapshot is not `Object.is`-equal to the last,
     * so a new object per read would be an infinite render loop — the standard
     * trap, avoided by construction the way the session store avoids it.
     */
    get: (): GridPreferences => preferences,

    set: (next: GridPreferences): void => {
      preferences = next;
      persist(() => {
        storage.write(
          key,
          JSON.stringify({
            v: 1,
            sizing: next.sizing,
            order: next.order,
            hidden: next.hidden,
          }),
        );
      });
      notify();
    },

    /**
     * Back to what the config says, and the entry goes with it.
     *
     * Removing rather than writing the defaults is what makes Reset mean "I
     * have no opinion" instead of "my opinion happens to match today's config"
     * — so a column added tomorrow arrives at its own default rather than at a
     * frozen snapshot of this one.
     */
    reset: (): void => {
      persist(() => {
        storage.remove(key);
      });
      preferences = fromDefaults();
      notify();
    },

    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  } as const;
};

export type GridPreferencesStore = ReturnType<typeof createGridPreferences>;
