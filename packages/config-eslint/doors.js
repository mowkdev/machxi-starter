/**
 * ADR-0051's door rule, as data (ADR-0062 §1).
 *
 * Every app reaches a platform package through its own `shared/` slices and
 * never by naming the package, and the rule that enforces it is
 * `no-restricted-imports` — once globally, and once per door slice with the
 * group that slice *is* the door for removed. `apps/customer` generated those
 * blocks from a table at `D12.1`; `apps/admin` wrote out every other door's
 * patterns inside each of nine blocks, in 745 lines. This is the customer's
 * helper, moved here so both apps — and any third — consume one implementation
 * and declare only their table.
 *
 * **A door is exempt from its own groups and from no others.** Turning the
 * rule off wholesale for a door's directory would open a hole in every other
 * door: `shared/i18n` composes package catalogues, and a blanket `off` would
 * let it — and anything added to the slice later — reach `@repo/ui/components/*`
 * directly.
 *
 * **A slice may be the door for more than one package**, and that is why the
 * blocks are grouped by *slice* rather than emitted per row: `shared/ui` is
 * the door for `@repo/ui` and for the rendering half of `@repo/app-kit`, and
 * two blocks naming the same files would leave whichever ESLint applied last
 * silently deciding the rule.
 *
 * @typedef {object} Door
 * @property {readonly string[]} slices `src/shared/*` directories that are the
 *   door for this package.
 * @property {readonly string[]} group The import patterns the door covers.
 * @property {string} message What a violator is told, ADR number included.
 */

/** One `no-restricted-imports` setting carrying every door in `doors`. */
export const restrictImports = (doors) => [
  "error",
  { patterns: doors.map(({ group, message }) => ({ group, message })) },
];

/**
 * Which doors each slice is the door for, as a map. The shape both
 * {@link doorRules} and {@link doorBypass} are built on.
 *
 * @param {readonly Door[]} doors
 * @returns {Map<string, Door[]>}
 */
const doorsBySlice = (doors) => {
  /** @type {Map<string, Door[]>} */
  const bySlice = new Map();

  for (const door of doors)
    for (const slice of door.slices)
      bySlice.set(slice, [...(bySlice.get(slice) ?? []), door]);

  return bySlice;
};

/**
 * One config block per door slice, each carrying every group **except** the
 * ones that slice is the door for.
 *
 * @param {readonly Door[]} doors
 * @param {string} [root] The slice root, if an app ever renames `src/shared`.
 * @returns {import("eslint").Linter.Config[]}
 */
export const doorRules = (doors, root = "src/shared") =>
  [...doorsBySlice(doors)].map(([slice, own]) => ({
    files: [`${root}/${slice}/**`],
    rules: {
      "no-restricted-imports": restrictImports(
        doors.filter((door) => !own.includes(door)),
      ),
    },
  }));

/**
 * A file-level exemption: one block for `files`, carrying every door except
 * those with **any** slice in `opens`.
 *
 * "Any", not "all", and the difference became visible when one package first
 * took three slices: opening `i18n` for a file opens `@repo/app-kit` with it,
 * because the kit is reached through `shared/i18n` as well as `shared/ui` and
 * `shared/api`. That is the behaviour this exemption wants — the file it names
 * composes package catalogues, and the kit is where the factory it hands them
 * to lives — but it is wider than a per-slice reading would suggest, so the
 * sentence says so.
 *
 * The one use is the app i18n factory (ADR-0046 §13), which composes the
 * catalogues its rendering packages ship and so must reach them directly —
 * routing a translation bundle through a door built for a form would make that
 * door export copy. A **file**, never a slice: the rest of `shared/i18n` needs
 * no such reach, and an exemption that covered it would be a hole rather than
 * a permission.
 *
 * @param {object} options
 * @param {readonly Door[]} options.doors
 * @param {readonly string[]} options.files
 * @param {readonly string[]} options.opens Slice names this file may bypass.
 * @returns {import("eslint").Linter.Config}
 */
export const doorExemption = ({ doors, files, opens }) => ({
  files: [...files],
  rules: {
    "no-restricted-imports": restrictImports(
      doors.filter(({ slices }) =>
        slices.every((slice) => !opens.includes(slice)),
      ),
    ),
  },
});

/**
 * The harness bypass: the blocks that let an app's **test files** reach one
 * door's package directly, without closing any door they already had.
 *
 * Its one use is a package with a second entry point the suite reaches for
 * itself. `@repo/app-kit/testing` is the MSW server and the jsdom setup file,
 * and every test file in an app imports the server from it;
 * `no-restricted-imports` matches a group by prefix and its negations do not
 * undo one, so the subpath cannot be carved out of the row. **What this opens
 * is therefore the whole door, not the subpath** — a test may import the kit
 * directly. That is the same latitude `boundaries/ignore` already gives test
 * files, on the same argument: a test may reach into internals its neighbours
 * may not, which is what makes it a unit test rather than a second consumer.
 *
 * **Two kinds of block, and the second is the reason this is not one line.**
 * These blocks come last, so whatever they set is what a test file gets — and
 * a single block over every test file would *re-impose* each door on the
 * tests that live inside it: `src/shared/form/__tests__/**` would be refused
 * `@repo/form`, which is the one package those tests exist to exercise. So a
 * slice's own tests get a block that subtracts the slice's own doors as well.
 *
 * @param {object} options
 * @param {readonly Door[]} options.doors
 * @param {readonly string[]} options.files Test globs outside a door slice.
 * @param {readonly Door[]} options.opens Door rows these files may bypass.
 * @param {string} [options.root] The slice root, matching {@link doorRules}.
 * @returns {import("eslint").Linter.Config[]}
 */
export const doorBypass = ({ doors, files, opens, root = "src/shared" }) => {
  const shared = doors.filter((door) => !opens.includes(door));

  return [
    { files: [...files], rules: { "no-restricted-imports": restrictImports(shared) } },
    ...[...doorsBySlice(doors)].map(([slice, own]) => ({
      files: [`${root}/${slice}/**/__tests__/**`],
      rules: {
        "no-restricted-imports": restrictImports(
          shared.filter((door) => !own.includes(door)),
        ),
      },
    })),
  ];
};
