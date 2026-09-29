# ADR-0076: The native compiler — `tsc -b` on TypeScript 7, 6.0 kept for the linter (supersedes ADR-0062 and ADR-0073 in part — deltas)

- Status: accepted
- Date: 2026-09-29
- Supersedes: [ADR-0062](0062-frontend-build-and-shared-composition.md) as carried by [ADR-0073](0073-review-hardening.md) (delta: §3's declarations-only build is emitted by the native compiler, whose declarations are type-equivalent to 6.0's and not byte-identical to them); [ADR-0073](0073-review-hardening.md) as carried by [ADR-0074](0074-review-follow-ups.md) (delta: §7's "exact for the compiler" names two exact versions, the catalog's 7 and the linter's 6.0 alias, each with its reason in `renovate.json`'s register). Both parents stand for everything not named here.

> Written 2026-09-29 for D21 ([`docs/plan/0021-stack-majors.md`](../plan/0021-stack-majors.md)) at the head of `D21.6`, the timeboxed spike, once its numbers were in: the spike came back green inside its box, and the plan lands a green spike with this record. **Accepted at the head of `D21.6`**, the step that builds it; [ADR-0062](0062-frontend-build-and-shared-composition.md) and [ADR-0073](0073-review-hardening.md) moved to `superseded by` in the same change, because the tree carries the delta in that commit. Joined D21's window; **D21 shipped 2026-09-29 and the window shut with it**, so this record now changes only by supersession ([the ledger](../plan/README.md#the-window)).

## Context

TypeScript 7 is the compiler rewritten as a native binary. 7.0.2 has been on the registry since 2026-07-08. The package ships a `tsc` and no JavaScript API: its main export returns the version, and what API there is sits under `typescript/unstable/*`. `typescript-eslint` 8.x, which runs the type-aware lint rules, imports TypeScript's JavaScript API and declares `typescript` below 6.1. So 7 can run `tsc -b`, and the linter cannot run on it.

`D21.5` took the tree to 6.0, the bridge release. The spike at `D21.6` then ran 7 as the compiler behind `check-types` in a worktree with its own install, with 6.0 kept for the linter, and measured it against 6.0 on the same tree. These are the numbers, with `TURBO_CONCURRENCY=2` on one machine:

| Measurement                                          | 6.0.3 | 7.0.2 |
| ---------------------------------------------------- | ----- | ----- |
| `pnpm check-types --force`, every buildinfo removed  | 49.8s | 15.3s |
| `pnpm check-types --force`, buildinfo in place       | 4.6s  | 5.0s  |
| one `tsc -b` over all sixteen projects, cold         | 40.0s | 6.7s  |
| one `tsc -b` over all sixteen projects, nothing to do | 0.32s | 0.27s |

The warm `check-types` rows are turbo and pnpm starting sixteen processes, not compiling. Neither compiler reports a diagnostic on the tree. A deliberate type error is reported by both, and the `types: []` probe from `D21.5` fails the same way on both (TS2591).

## Decision

### 1. `tsc -b` runs TypeScript 7 (delta on ADR-0062 §3)

`pnpm-workspace.yaml`'s catalog states `typescript` as `7.0.2`, exact, and every workspace declares `catalog:`. So every `check-types` is `tsc -b` on the native compiler. The project references, the composite packages, the declarations-only emit into the gitignored `dist-types/` and the rule that nothing at runtime resolves to it stand as ADR-0062 §3 wrote them.

The declarations are the native compiler's own. They are **type-equivalent to 6.0's and not byte-identical**: 24 of 302 files differ. The differences are union members, and some inferred object members, in a different order, `typeof X` where 6.0 inlined the signature, source quote style kept, and `& unknown` on one generic constraint. Every consumer's `tsc -b` runs the same compiler that wrote the emit it reads. The linter's 6.0 resolves each package through its `exports` to the source (ADR-0002), not to `dist-types/`. A reader that diffs emitted declarations across a compiler major should expect this.

Two behaviours did not change, and both were measured at `D21.6`:

- **Where the compiler keeps its memory.** A composite package's buildinfo is still written beside its declarations in `dist-types/`, and an app's still goes to `tsconfig.tsbuildinfo`. ADR-0073 §6's invariant holds unchanged, and so does its residual. `D20.12`'s two-command experiment on `@repo/logger` masks a type error on 7 exactly as it does on 6.0. So D27's question, what `check-types` caches for a referenced project, is the same question on either compiler.
- **Declarations are written even when a package has errors**, as on 6.0. The exit code is `2` on 7 and `1` on 6.0. Both are non-zero, so the gate fails the same way.

The API's build and `@repo/db`'s bundles are `tsdown` with `dts` off. They invoke no TypeScript compiler, so this record does not change them.

### 2. The compiler is two exact versions (delta on ADR-0073 §7)

ADR-0073 §7 makes the compiler exact. From here that rule covers two versions, each with its reason in `renovate.json`'s register:

- **The catalog's `typescript`, 7.** This is what every `tsc -b` runs. It moves under the pin rule, in one pull request.
- **`@repo/eslint-config`'s `typescript`, declared as `npm:typescript@6.0.3`.** That is the one manifest that installs `typescript-eslint`, so the linter's peer resolves to 6.0 there and the type-aware rules keep running on the JavaScript API they need. The alias is an exact pin under §7, not a hold. A Renovate rule caps what Renovate proposes for it below 6.1, which is the edge of `typescript-eslint`'s peer range.

ADR-0074 §2 does not apply here. That rule makes a version held below the newest into one `overrides` fact, because a hold has to bind every resolution of a name. This alias binds only its own resolution in one manifest, and the name `typescript` stays at 7 everywhere else. An override would do the opposite and bind the whole tree.

The lockfile carries exactly those two versions of `typescript`. `scripts/docs-hygiene.test.mjs` "the compiler is two facts" checks four things and fails on any other shape: the catalog names the compiler, only `@repo/eslint-config` declares something other than `catalog:`, its alias is exact and on an older major, and the lockfile resolves those two versions and no third.

`eslint-plugin-boundaries` in both apps also installs a second `@typescript-eslint/parser` instance. It comes through `eslint-module-utils`' optional peer, and it resolves `typescript` to the apps' 7. Nothing loads that instance: under flat config, `eslint-module-utils` parses with the parser object the config hands it, which is the 6.0 instance. `pnpm-workspace.yaml`'s `peerDependencyRules` admits the four `@typescript-eslint/*>typescript` peers by name, with this reason beside them (ADR-0074 §2).

**The way out is one pull request.** It takes the first `typescript-eslint` whose peer range names 7. That pull request puts `catalog:` back in `@repo/eslint-config`, removes the four peer entries and the Renovate hold, and narrows the hygiene case back to one version.

**Carried unchanged by reference.** Everything else in ADR-0062 §3 (as carried by 0073) and ADR-0073 §7 (as carried by 0074) stands and is in force as part of this record: the caret default, the catalog threshold, the digest-pinned actions, the base-image rule, the holds as `overrides`, the cooldown and `trustLockfile`.

## Consequences

- `check-types` from cold is about a third of what it was, and one whole-tree `tsc -b` is about a sixth. The gate's second link shortens by the same factor from cold.
- `pnpm outdated -r` lists `@repo/eslint-config`'s `typescript` one major behind. That is the alias doing its job, in the same sense as `@types/node` at the floor, and D21's notes name it.
- Editors are not configured by this tree. An editor's own TypeScript service, or 7's language server, is a developer's choice, and the gate does not read it.
- `typescript-eslint` sets when the tree returns to one compiler. The register rule names the release to wait for.

## Alternatives considered

- **Stay on 6.0 until `typescript-eslint` supports 7.** Rejected on the numbers. The spike found no blocker, and the plan lands a green spike.
- **Keep `typescript` at 6.0 everywhere and add 7 under an alias name.** This would put two packages that both provide a `tsc` bin in every workspace. Each `check-types` script would then have to name a path in place of `tsc -b`, and sixteen manifests would carry the workaround. Aliasing 6.0 in the one manifest that needs it is one line.
- **Microsoft's `@typescript/typescript6` wrapper for the linter.** `typescript-eslint` imports `typescript` by name, so the wrapper would still need an alias or an override to reach it. It also depends on `typescript@6` itself, so the lockfile would carry the same two versions plus a third package.
- **An `overrides` entry forcing `typescript-eslint`'s `typescript` to 6.0 tree-wide.** Rejected. ADR-0074 §2 reserves `overrides` for holds that bind every resolution of a name, and this one would have to bind a peer of one tool while leaving the same name at 7 for everything else. The manifest alias states exactly that, where it applies.
