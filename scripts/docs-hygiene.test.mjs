import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LEDGER,
  LEDGER_WINDOW,
  TAG_PREFIX_LINE,
  checkLanes,
  checkSpec,
  checkTagPrefix,
  checkText,
  inheritedDocuments,
  isExcluded,
  parseLanes,
  parseTagPrefix,
  scan,
  scanLanes,
  scanSpecs,
  scanTagPrefix,
  specDocuments,
} from "./docs-hygiene.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("CLAUDE.md stays under 6 KB", async () => {
  // Every session pays for this file. It carries rules, commands, the repo map,
  // search and workflow — no window history and no supersession chronology.
  const { size } = await stat(path.join(repoRoot, "CLAUDE.md"));
  assert.ok(size < 6 * 1024, `CLAUDE.md is ${size} bytes`);
});

const rules = (violations) => violations.map((v) => v.rule);

test("the documents a fork inherits are clean", async () => {
  const violations = await scan();
  assert.deepEqual(
    violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.found}`),
    [],
  );
});

test("the scan covers .claude/** and the always-loaded summary", async () => {
  const files = (await inheritedDocuments()).map((f) => f.rel);
  assert.ok(files.includes("CLAUDE.md"));
  assert.ok(files.includes(".claude/README.md"));
  assert.ok(files.some((f) => f.startsWith(".claude/rules/")));
  assert.ok(files.some((f) => f.startsWith(".claude/agents/")));
  assert.ok(files.some((f) => f.startsWith(".claude/skills/")));
});

test("the scan skips a git worktree parked under .claude", async () => {
  // `.claude/worktrees/` holds a second checkout of this repository, untracked
  // and often mid-step on another branch. Scanned, its documents are read as
  // somebody else's biography and redden this check for every session in the
  // tree over files git does not track. The prefix must be a path segment: a
  // file whose name merely starts with the same letters is still scanned.
  assert.ok(isExcluded(".claude/worktrees"));
  assert.ok(isExcluded(".claude/worktrees/specs/CLAUDE.md"));
  assert.ok(!isExcluded(".claude/worktrees-and-why.md"));
  assert.ok(!isExcluded(".claude/README.md"));

  // Over a fixture rather than this tree: the directory is gitignored, so on
  // CI and in a fresh clone it does not exist and an assertion about the real
  // walk would pass by finding nothing.
  const root = await mkdtemp(path.join(tmpdir(), "docs-hygiene-"));
  await mkdir(path.join(root, ".claude", "worktrees", "specs"), {
    recursive: true,
  });
  await writeFile(path.join(root, "CLAUDE.md"), "# fixture\n");
  await writeFile(path.join(root, ".claude", "README.md"), "# fixture\n");
  await writeFile(
    path.join(root, ".claude", "worktrees", "specs", "CLAUDE.md"),
    "Accepted at `D14.12`'s head on 2026-09-02.\n",
  );

  const files = (await inheritedDocuments(root)).map((f) => f.rel);
  assert.deepEqual(files, [".claude/README.md", "CLAUDE.md"]);
  await rm(root, { recursive: true, force: true });
});

/**
 * The prose and the source under a repo-relative directory, minus the excluded
 * paths. The extension list is the point rather than a filter for speed: the
 * scan has to be a pure function of tracked repository content or the task
 * around it cannot be cached (ADR-0026 §The rule). `.claude/` also holds
 * `settings.local.json`, which is git-ignored and per-machine — reading it
 * would red this test on one developer's clone and nowhere else.
 */
const SCANNED = new Set([".md", ".ts", ".tsx"]);

async function filesUnder(dir) {
  const out = [];
  const walk = async (full) => {
    for (const entry of await readdir(full, { withFileTypes: true })) {
      const child = path.join(full, entry.name);
      const rel = path.relative(repoRoot, child).split(path.sep).join("/");
      if (isExcluded(rel) || entry.name === "node_modules") continue;
      if (entry.isDirectory()) await walk(child);
      else if (SCANNED.has(path.extname(entry.name)))
        out.push({ full: child, rel });
    }
  };
  await walk(path.join(repoRoot, dir));
  return out;
}

test("nothing a fork inherits states the marketing app as present", async () => {
  // The Next.js app left this tree before either SPA shipped, and the
  // marketing site is a planned deliverable that scaffolds fresh. A skill or a
  // source comment that names its path in the present tense sends the reader
  // to a directory that is not there, and a fork inherits the claim. Both
  // trees travel: `.claude/` as the machinery that applies the records, and
  // `packages/ui/src` as code.
  const offenders = [];
  for (const dir of [".claude", "packages/ui/src"]) {
    for (const { full, rel } of await filesUnder(dir)) {
      const text = await readFile(full, "utf8");
      text.split(/\r?\n/).forEach((line, index) => {
        if (line.includes("apps/web")) offenders.push(`${rel}:${index + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, []);
});

/**
 * A `"use client"` line in a module's directive prologue — the only place a
 * bundler reads one. A function of the text, so the negative case below is a
 * call rather than a temporarily broken tree.
 */
const CLIENT_DIRECTIVE = /^\s*(["'])use client\1;?\s*$/;
const clientDirectiveLines = (text) =>
  text
    .split(/\r?\n/)
    .flatMap((line, index) => (CLIENT_DIRECTIVE.test(line) ? [index + 1] : []));

/**
 * The generated regime of `@repo/ui` (ADR-0047 §What-code): byte-identical to
 * what the shadcn CLI emits, directive included, and upgraded by regenerating
 * — so a directive there is the CLI's, not a rule of this repository's.
 */
const GENERATED_UI = ["packages/ui/src/components/", "packages/ui/src/hooks/"];

test("no client directive under `packages/ui`", async () => {
  // ADR-0074 §7, `FE-12`: the rule that stateful compositions carry
  // `"use client"` was kept for a Next consumer no app is, and a directive
  // nothing consumes is a claim no suite can refute. So the hand-written half
  // of the package — the compositions, `ui-strings.tsx`, anything added
  // beside them — carries none, and a consumer that needs the boundary
  // reintroduces it by its own record, together with this case.
  const offenders = [];
  for (const { full, rel } of await filesUnder("packages/ui/src")) {
    if (GENERATED_UI.some((prefix) => rel.startsWith(prefix))) continue;
    for (const line of clientDirectiveLines(await readFile(full, "utf8")))
      offenders.push(`${rel}:${line}`);
  }
  assert.deepEqual(offenders, []);

  // The case can see what it refuses, in both quote styles, and not the
  // phrase in prose.
  assert.deepEqual(clientDirectiveLines('"use client";\n\nimport x;\n'), [1]);
  assert.deepEqual(clientDirectiveLines("'use client'\n"), [1]);
  assert.deepEqual(clientDirectiveLines(' * `"use client"` because…\n'), []);
});

/**
 * The trees the thousand-line ceiling covers: the API's feature modules and
 * its `core`, and the two platform packages whose entry files had grown into
 * everything at once. They are named rather than globbed because the ceiling
 * is a claim about *these* trees — a package that has never had the problem
 * does not silently inherit a rule nobody argued for.
 *
 * `core` joined at `D28.7` (ADR-0074 §8, `API-08`): the ceiling was set on the
 * trees D20 split, and the largest API file left outside it —
 * `core/config/schema.ts`, 908 lines — sat in the one tree it did not name.
 */
const LINE_CEILING_ROOTS = [
  "apps/api/src/core",
  "apps/api/src/modules",
  "packages/api-client/src",
  "packages/grid/src",
];

const LINE_CEILING = 1000;

test("no source file in the split trees runs past a thousand lines", async () => {
  // A file cohesive by aggregate stops being cohesive by reader somewhere
  // around here: `auth.service.ts` held login, refresh, registration,
  // verification, recovery, onboarding, email change, impersonation and the
  // federated exchange at 2,264 lines, `client.ts` the axios instance, the
  // interceptors, the session lifecycle and twelve flows, `app-grid.tsx` state
  // wiring, header, body, selection and density. The number is a smell
  // detector rather than a law — nothing goes wrong at 1,001 lines — but it is
  // the only mechanical guard against the drift coming straight back, which is
  // what happened between the file being split once by hand and reviewed again.
  //
  // `__tests__` is deliberately out of scope. A table-driven suite is long by
  // construction and its length says nothing about whether a reader can hold
  // it; the finding this case closes listed source files only.
  const offenders = [];
  const read = [];
  for (const root of LINE_CEILING_ROOTS) {
    const files = await filesUnder(root);
    // A renamed or moved directory would make the walk find nothing and the
    // assertion below pass by checking nothing at all.
    assert.ok(files.length > 0, `no files under ${root}`);
    for (const { full, rel } of files) {
      if (path.extname(rel) === ".md") continue;
      if (rel.split("/").includes("__tests__")) continue;
      read.push(rel);
      // The trailing newline is not a line. Splitting the raw text counts the
      // empty string after it, which would make the guard fire at 1,000 and
      // report every file one line longer than an editor and `wc -l` do — a
      // ceiling whose number disagrees with its own name is the kind of thing
      // somebody later "fixes" in the wrong direction.
      const text = await readFile(full, "utf8");
      const lines = text ? text.replace(/\r?\n$/, "").split(/\r?\n/).length : 0;
      if (lines > LINE_CEILING) offenders.push(`${rel} — ${lines} lines`);
    }
  }
  assert.ok(read.length > 0, "the ceiling read no source files");
  assert.deepEqual(offenders, []);
});

test("every workflow action is pinned to a commit digest", async () => {
  // A `uses:` on a moving tag (`actions/checkout@v4`) runs whatever that tag
  // points at on the day the job starts, with the workspace and the job's
  // token. Only a 40-hex commit digest is a reference the action's owner
  // cannot repoint (ADR-0073 §7); `helpers:pinGitHubActionDigests` in
  // `renovate.json` is what keeps the pin moving. Local composite steps
  // (`uses: ./…`) and container steps (`uses: docker://…`) are not tags and
  // are not pinned this way.
  const dir = path.join(repoRoot, ".github", "workflows");
  const files = (await readdir(dir)).filter((f) => /[.]ya?ml$/.test(f));
  assert.ok(files.length > 0, "no workflows found");

  const offenders = [];
  for (const file of files) {
    const text = await readFile(path.join(dir, file), "utf8");
    text.split(/\r?\n/).forEach((line, index) => {
      const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
      if (!match) return;
      const ref = match[1];
      if (ref.startsWith("./") || ref.startsWith("docker://")) return;
      if (!/@[0-9a-f]{40}$/.test(ref))
        offenders.push(`.github/workflows/${file}:${index + 1} ${ref}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("one Node major, stated in every place that states one", async () => {
  // `.nvmrc`, the root `engines`, both workflows and the three Dockerfiles are
  // the runtime floor written down seven times, and the failure is always the
  // same one: a bump lands in some of them (ADR-0073 §4). The major is what is
  // compared, because each file states it at its own precision — `.nvmrc` and
  // the workflows a bare major, `engines` the patch line the dependency tree
  // actually needs, the images a tag.
  const major = (v) => /(\d+)/.exec(v)?.[1];
  const read = (rel) => readFile(path.join(repoRoot, rel), "utf8");

  const found = { ".nvmrc": major(await read(".nvmrc")) };

  const pkg = JSON.parse(await read("package.json"));
  found["package.json engines.node"] = major(pkg.engines.node);

  // Every occurrence, not the first: a workflow grows a second job and an
  // image a second build stage, and a floor that moved in one of them is the
  // drift this case exists to catch.
  const all = (text, pattern, label) => {
    const matches = [...text.matchAll(pattern)];
    assert.ok(matches.length > 0, `no Node version in ${label}`);
    matches.forEach((m, i) => {
      found[`${label}[${i}]`] = major(m[1]);
    });
  };

  for (const file of ["gate.yml", "e2e.yml"]) {
    all(
      await read(`.github/workflows/${file}`),
      /^\s*node-version:\s*(\S+)/gm,
      file,
    );
  }

  for (const app of ["api", "admin", "customer"]) {
    all(
      await read(`apps/${app}/Dockerfile`),
      /^FROM node:(\S+?)-/gm,
      `apps/${app}/Dockerfile`,
    );
  }

  const majors = new Set(Object.values(found));
  assert.equal(
    majors.size,
    1,
    `the Node major disagrees: ${JSON.stringify(found)}`,
  );
  assert.ok([...majors][0], "no Node version found");
});

/**
 * A JSON file that may carry comments. `turbo.json` and the workspace
 * `tsconfig.json` files hold the reasoning for the settings this case is
 * about; `JSON.parse` refuses a `//` line, and the two parsers that actually
 * read these files — turbo's and TypeScript's — do not.
 */
const parseJsonc = (text) => {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/"))
        i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return JSON.parse(out);
};

/** A repo path as the manifests write it: forward slashes, no `./`, no tail. */
const posix = (p) =>
  p
    .split(path.sep)
    .join("/")
    .replace(/^[.]\//, "")
    .replace(/\/$/, "");

/** A Turborepo `outputs` glob reduced to the directory the cache restores. */
const cachedDir = (glob) => posix(glob.replace(/\/\*\*?$/, ""));

const under = (file, dir) => file === dir || file.startsWith(`${dir}/`);

/** `extends` as a list, whichever of its two shapes the file uses. */
const extendsOf = (config) =>
  config.extends === undefined
    ? []
    : [config.extends].flat().map((preset) => posix(preset));

/**
 * Whether the project emits the artifact its `outDir` is for. Every emitting
 * workspace here takes the shared `composite.json` preset, which is where
 * `declaration`, `emitDeclarationOnly` and the `noEmit: false` that undoes the
 * base live; the two local spellings are accepted beside it so a project that
 * stops extending the preset still answers truthfully.
 */
const emits = (config) =>
  config.compilerOptions?.composite === true ||
  config.compilerOptions?.emitDeclarationOnly === true ||
  extendsOf(config).some((preset) => preset.endsWith("/composite.json"));

/**
 * Where `tsc` keeps a project's incremental state: the declared file, or
 * TypeScript's own default — `<outDir>/<config>.tsbuildinfo` where there is an
 * `outDir`, and `<config>.tsbuildinfo` beside the config where there is not.
 * A `rootDir` moves that default; nothing here sets one, and the case asserts
 * that rather than letting this guess at a shape it has never seen.
 */
const buildInfoOf = (rel, options) =>
  options.tsBuildInfoFile
    ? posix(options.tsBuildInfoFile)
    : `${options.outDir ? `${posix(options.outDir)}/` : ""}${path.basename(rel, ".json")}.tsbuildinfo`;

/**
 * The offence, as one string, or `null`. A buildinfo under a cached output is
 * restored by the very task whose result it decides — unless the project emits
 * into that same directory, in which case the cache restores the artifact the
 * compile produced and not merely a note saying it happened. A declared
 * `outDir` is not enough on its own: a `noEmit` project can name one, and then
 * the directory holds the note and nothing else, which is this case's subject.
 */
const decidesItsOwnResult = (rel, config, cached) => {
  const options = config.compilerOptions ?? {};
  const info = buildInfoOf(rel, options);
  const dir = cached.find((d) => under(info, d));
  if (!dir) return null;
  if (options.outDir && under(posix(options.outDir), dir) && emits(config))
    return null;
  return `${rel} — ${info} under the cached ${dir}/`;
};

/**
 * The checks the first link fails to name.
 *
 * A check is a script that can go red without writing anything: at the root, a
 * script that is not a `turbo run` launcher and is named `*:check` or runs
 * `node --test`; in a workspace, a script named `*:check`. The gate's own links
 * are excluded — they run as links, not through the first one. A root check is
 * named in `lint`'s `dependsOn` as `//#<script>`, a workspace one by its bare
 * task name, which turbo resolves in each package that defines it.
 */
const missingFirstLinkChecks = ({ turbo, root, workspaces, gate }) => {
  const dependsOn = new Set(turbo.tasks?.lint?.dependsOn ?? []);
  const isCheck = (name) => name.endsWith(":check");
  const wanted = new Set();
  for (const [name, command] of Object.entries(root.scripts ?? {})) {
    if (gate.includes(name) || /\bturbo\s+run\b/.test(command)) continue;
    if (isCheck(name) || /\bnode\b.*\s--test\b/.test(command))
      wanted.add(`//#${name}`);
  }
  // A bare task name reaches only the packages that run `lint`: a check in a
  // workspace with no `lint` script is never scheduled by it, so it is named
  // by its package and the case stays red until something runs it.
  for (const pkg of workspaces)
    for (const name of Object.keys(pkg.scripts ?? {}))
      if (isCheck(name) && !gate.includes(name))
        wanted.add(pkg.scripts.lint ? name : `${pkg.name}#${name}`);
  return [...wanted].filter((task) => !dependsOn.has(task)).sort();
};

test("the first link carries every check that can go red", async () => {
  // CI-08: `i18n:check` ran in `pnpm check` and in no link of the gate, so a
  // forgotten key was red in a terminal and green on a pull request — the
  // promise ADR-0046 §9 made held for one of the two. ADR-0074 §1 puts every
  // check on the first link and this case keeps it there by predicate rather
  // than by memory: the next `*:check` a workspace defines is red here until
  // `lint` depends on it.
  const read = (rel) => readFile(path.join(repoRoot, rel), "utf8");
  const gate = [
    .../pnpm lint && pnpm check-types[^\n`]*/
      .exec(await read("CLAUDE.md"))[0]
      .split("&&")
      .map((link) => link.trim().replace(/^pnpm\s+/, "")),
  ];
  assert.deepEqual(
    gate,
    ["lint", "check-types", "test", "size", "format:check"],
    "the gate as CLAUDE.md defines it",
  );

  const workspaces = [];
  for (const group of ["apps", "packages"])
    for (const entry of await readdir(path.join(repoRoot, group), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const text = await read(`${group}/${entry.name}/package.json`).catch(
        () => null,
      );
      if (text !== null) workspaces.push(JSON.parse(text));
    }
  // A moved workspace root would make the predicate find nothing to demand.
  assert.ok(workspaces.length > 10, `only ${workspaces.length} workspaces`);

  const input = {
    turbo: parseJsonc(await read("turbo.json")),
    root: JSON.parse(await read("package.json")),
    workspaces,
    gate,
  };
  assert.deepEqual(missingFirstLinkChecks(input), []);

  // The predicate itself: it finds the three checks this repository defines,
  // and it reddens when one is dropped from the first link.
  const dependsOn = input.turbo.tasks.lint.dependsOn;
  for (const task of ["//#test:scripts", "//#docs:check", "i18n:check"])
    assert.ok(dependsOn.includes(task), `lint does not depend on ${task}`);
  const without = (task) => ({
    ...input,
    turbo: {
      tasks: { lint: { dependsOn: dependsOn.filter((t) => t !== task) } },
    },
  });
  assert.deepEqual(missingFirstLinkChecks(without("i18n:check")), [
    "i18n:check",
  ]);
  assert.deepEqual(missingFirstLinkChecks(without("//#docs:check")), [
    "//#docs:check",
  ]);
});

/**
 * Why `test:unit`'s hash would miss its workspace dependencies, or `null`.
 *
 * Turbo hashes a task over its own package's files and the hashes of the tasks
 * it depends on, so a suite that runs a package's source sees that source only
 * through a `^` edge: `^test:unit` itself, or a task that exists for no other
 * reason — turbo's transit node, named in `dependsOn`, reaching `^` itself and
 * defined as a script by no workspace, so it is hashed and never run.
 */
const unitHashGap = ({ turbo, workspaces }) => {
  const tasks = turbo.tasks ?? {};
  const deps = tasks["test:unit"]?.dependsOn ?? [];
  if (deps.includes("^test:unit")) return null;
  const transit = deps.find(
    (name) =>
      !name.startsWith("^") &&
      (tasks[name]?.dependsOn ?? []).includes(`^${name}`),
  );
  if (!transit)
    return "test:unit depends on no ^ edge — a package's source is outside its hash";
  const runs = workspaces.filter((pkg) => pkg.scripts?.[transit]);
  if (runs.length > 0)
    return `${transit} is a script in ${runs.map((pkg) => pkg.name).join(", ")} — it would run, not only hash`;
  return null;
};

test("a unit suite's hash covers its workspace dependencies", async () => {
  // Found at D28.10: `test:unit` declared `dependsOn: []`, so `admin#test:unit`
  // hashed admin's files alone and a change in `@repo/vitest-config` replayed
  // the old green from `pnpm check`. ADR-0026 as carried by ADR-0074 (amended
  // at D28.11): the cache may decide a result only over everything that result
  // is a function of, and a source-only package's code is part of it.
  const read = (rel) => readFile(path.join(repoRoot, rel), "utf8");
  const workspaces = [];
  for (const group of ["apps", "packages"])
    for (const entry of await readdir(path.join(repoRoot, group), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const text = await read(`${group}/${entry.name}/package.json`).catch(
        () => null,
      );
      if (text !== null) workspaces.push(JSON.parse(text));
      // A workspace may redefine the task; its own `dependsOn` would then be
      // the one turbo reads for that package.
      const own = await read(`${group}/${entry.name}/turbo.json`).catch(
        () => null,
      );
      if (own !== null)
        assert.equal(
          parseJsonc(own).tasks?.["test:unit"]?.dependsOn,
          undefined,
          `${group}/${entry.name}/turbo.json redefines test:unit's dependsOn`,
        );
      if (own !== null)
        assert.equal(
          parseJsonc(own).tasks?.transit?.dependsOn,
          undefined,
          `${group}/${entry.name}/turbo.json redefines transit's dependsOn — it would cut the chain there`,
        );
    }
  assert.ok(workspaces.length > 10, `only ${workspaces.length} workspaces`);

  const turbo = parseJsonc(await read("turbo.json"));
  assert.equal(unitHashGap({ turbo, workspaces }), null);

  // The predicate itself: red on the shape that lied, and on a transit node
  // some workspace would run.
  const withUnit = (dependsOn, extra = {}) => ({
    turbo: { tasks: { ...turbo.tasks, ...extra, "test:unit": { dependsOn } } },
    workspaces,
  });
  assert.match(unitHashGap(withUnit([])), /no \^ edge/);
  assert.match(
    unitHashGap(withUnit(["transit"], { transit: { dependsOn: [] } })),
    /no \^ edge/,
  );
  assert.equal(unitHashGap(withUnit(["^test:unit"])), null);
  assert.match(
    unitHashGap({
      ...withUnit(["transit"], { transit: { dependsOn: ["^transit"] } }),
      workspaces: [{ name: "x", scripts: { transit: "echo" } }],
    }),
    /would run/,
  );
});

/**
 * The package names `pnpm-workspace.yaml`'s `overrides` block holds. A key may
 * be quoted, scoped, carry a version selector (`foo@<2`) or a parent chain
 * (`parent>foo`); the name returned is the package the override binds.
 */
const overrideNames = (workspaceYaml) => {
  const block = /^overrides:\n((?:[ \t]+.*\n?|\s*#.*\n?|\s*\n)*)/m.exec(
    workspaceYaml,
  );
  if (!block) return [];
  return block[1]
    .split("\n")
    .map((line) => /^\s+(["']?)(.+?)\1\s*:/.exec(line)?.[2])
    .filter(Boolean)
    .map((key) =>
      key
        .split(">")
        .pop()
        .replace(/(.)@.*$/, "$1"),
    );
};

/**
 * Every version of each package the lockfile's `packages:` section resolves,
 * keyed by name — the section lists a package once per version, whatever
 * number of peers its snapshots are taken under.
 */
const lockfileVersions = (lock) => {
  // pnpm 12 writes the lockfile as two YAML documents, the first of which (the
  // tooling's own install) has `packages:` and `snapshots:` of its own; the
  // workspace's resolution is the last document's.
  const end = lock.lastIndexOf("\nsnapshots:\n");
  const start = lock.lastIndexOf("\npackages:\n", end < 0 ? undefined : end);
  assert.ok(start >= 0, "the lockfile has no packages: section");
  const versions = new Map();
  for (const line of lock.slice(start, end < 0 ? undefined : end).split("\n")) {
    const key = /^ {2}(["']?)(.+?)\1:\s*$/.exec(line)?.[2];
    if (!key) continue;
    const at = key.lastIndexOf("@");
    if (at <= 0) continue;
    const name = key.slice(0, at);
    if (!versions.has(name)) versions.set(name, new Set());
    versions.get(name).add(key.slice(at + 1));
  }
  return versions;
};

/**
 * The toolchain the repository builds and tests with, which has to be one
 * version for the same reason a hold does (ADR-0074 §2): Vitest 5 made `vite`
 * a peer, and a workspace that runs Vitest without declaring the bundler is
 * answered by `autoInstallPeers` with the newest release the range allows — a
 * second copy beside the one both apps build with. Not a hold, so not an
 * `overrides` entry; one version is asked of the lockfile all the same.
 * `eslint` joined at `D21.2`: a plugin whose peer range has not reached the
 * major (`eslint-plugin-react` on 10) is admitted by `peerDependencyRules`,
 * and the lockfile is what shows it was not answered with a second copy.
 * `typescript` left the list at `D21.6`: since 7 it is exactly two versions,
 * and "the compiler is two facts" below asks for those two.
 */
const ONE_VERSION_TOOLS = ["eslint", "vite", "vitest"];

/** The held packages and tools the lockfile resolves more than once, as strings. */
const heldTwice = (workspaceYaml, lock) => {
  const versions = lockfileVersions(lock);
  return [...new Set([...overrideNames(workspaceYaml), ...ONE_VERSION_TOOLS])]
    .filter((name) => (versions.get(name)?.size ?? 0) > 1)
    .map((name) => `${name}: ${[...versions.get(name)].sort().join(", ")}`);
};

test("a held dependency is one fact", async () => {
  // STK-08: `jsdom` was held by a pin in nine manifests and a Renovate rule,
  // and `autoInstallPeers` answered vitest's open peer with the held release
  // anyway in the seven workspaces that never declared it — two versions in
  // the lockfile, the broken one waiting for the first jsdom test in a node
  // package. ADR-0074 §2 moves the hold into `overrides`, which binds the
  // resolution; this case keeps it bound: every package that block names is
  // resolved at one version, or the hold is a hope again.
  const read = (rel) => readFile(path.join(repoRoot, rel), "utf8");
  const workspaceYaml = (await read("pnpm-workspace.yaml")).replace(
    /\r\n/g,
    "\n",
  );
  const lock = (await read("pnpm-lock.yaml")).replace(/\r\n/g, "\n");

  const held = overrideNames(workspaceYaml);
  assert.ok(
    held.includes("jsdom"),
    "pnpm-workspace.yaml no longer holds jsdom",
  );
  assert.equal(lockfileVersions(lock).get("jsdom")?.size, 1);
  for (const tool of ONE_VERSION_TOOLS) {
    assert.equal(lockfileVersions(lock).get(tool)?.size, 1, tool);
  }
  assert.deepEqual(heldTwice(workspaceYaml, lock), []);

  // The predicate itself: a lockfile carrying a second copy of a held package
  // is caught, and the parser reads the key shapes an override may take.
  const resolved = [...lockfileVersions(lock).get("jsdom")][0];
  const twice = lock.replace(
    `\n  jsdom@${resolved}:\n`,
    `\n  jsdom@999.0.0:\n    resolution: {integrity: sha512-x}\n\n  jsdom@${resolved}:\n`,
  );
  assert.deepEqual(heldTwice(workspaceYaml, twice), [
    `jsdom: ${resolved}, 999.0.0`,
  ]);
  const vite = [...lockfileVersions(lock).get("vite")][0];
  const viteTwice = lock.replace(
    `
  vite@${vite}:
`,
    `
  vite@999.0.0:
    resolution: {integrity: sha512-x}

  vite@${vite}:
`,
  );
  assert.deepEqual(heldTwice(workspaceYaml, viteTwice), [
    `vite: ${vite}, 999.0.0`,
  ]);
  assert.deepEqual(
    overrideNames(
      'overrides:\n  jsdom: 30.0.1\n  "@scope/pkg@<2": 1.0.0\n  parent>child: 2.0.0\nnext: x\n',
    ),
    ["jsdom", "@scope/pkg", "child"],
  );
});

/**
 * What is wrong with the compiler's resolution, or `null` (ADR-0076). Every
 * workspace but one declares `typescript` from the catalog; the one exception
 * is `@repo/eslint-config`, whose exact `npm:typescript@…` alias gives
 * `typescript-eslint` the JavaScript API the native compiler does not have,
 * and so sits on an older major. The lockfile carries those two versions and
 * no third.
 */
const compilerGap = ({ catalog, manifests, locked }) => {
  const alias = /^npm:typescript@(\d+)\.\d+\.\d+$/.exec(
    manifests["packages/config-eslint"] ?? "",
  );
  if (!alias) return "@repo/eslint-config does not alias an exact typescript";
  const aliasVersion = manifests["packages/config-eslint"].slice(
    "npm:typescript@".length,
  );
  if (Number(alias[1]) >= Number(catalog.split(".")[0]))
    return `the linter's typescript ${aliasVersion} is not older than the catalog's ${catalog}`;
  const strays = Object.entries(manifests)
    .filter(
      ([ws, spec]) => ws !== "packages/config-eslint" && spec !== "catalog:",
    )
    .map(([ws, spec]) => `${ws}: ${spec}`);
  if (strays.length)
    return `typescript outside the catalog in ${strays.join(", ")}`;
  const want = [aliasVersion, catalog].sort().join(", ");
  const have = [...locked].sort().join(", ");
  return want === have
    ? null
    : `the lockfile resolves typescript ${have}, not ${want}`;
};

test("the compiler is two facts: the catalog's, and the linter's beside it", async () => {
  // TypeScript 7 has no JavaScript API; `typescript-eslint` runs on one. So
  // `tsc -b` runs the catalog's 7 in every workspace, and the one manifest
  // that installs the linter keeps 6.0 under an alias (ADR-0076, `D21.6`).
  // A second workspace off the catalog, or a third version in the lockfile,
  // is the drift the catalog exists to prevent.
  const read = (rel) => readFile(path.join(repoRoot, rel), "utf8");
  const workspaceYaml = (await read("pnpm-workspace.yaml")).replace(
    /\r\n/g,
    "\n",
  );
  const lock = (await read("pnpm-lock.yaml")).replace(/\r\n/g, "\n");
  const catalog = /^catalog:\n(?:[ \t]+.*\n)*?[ \t]+typescript:\s*(\S+)/m.exec(
    workspaceYaml,
  )?.[1];
  assert.ok(catalog, "the catalog names no typescript");
  const manifests = {};
  for (const group of ["apps", "packages"]) {
    for (const name of await readdir(path.join(repoRoot, group))) {
      const pkg = JSON.parse(
        await read(path.join(group, name, "package.json")).catch(() => "{}"),
      );
      const spec =
        pkg.devDependencies?.typescript ?? pkg.dependencies?.typescript;
      if (spec) manifests[`${group}/${name}`] = spec;
    }
  }
  const locked = lockfileVersions(lock).get("typescript") ?? new Set();
  assert.equal(compilerGap({ catalog, manifests, locked }), null);

  // The predicate, on each shape it exists for.
  const alias = manifests["packages/config-eslint"].slice(
    "npm:typescript@".length,
  );
  const ok = { catalog, manifests, locked: new Set([catalog, alias]) };
  assert.equal(compilerGap(ok), null);
  assert.match(
    compilerGap({ ...ok, locked: new Set([catalog, alias, "9.9.9"]) }),
    /the lockfile resolves typescript/,
  );
  assert.match(
    compilerGap({ ...ok, manifests: { ...manifests, "apps/x": "7.0.0" } }),
    /outside the catalog in apps\/x/,
  );
  assert.match(
    compilerGap({
      ...ok,
      manifests: { ...manifests, "packages/config-eslint": "catalog:" },
    }),
    /does not alias/,
  );
  assert.match(
    compilerGap({
      ...ok,
      manifests: {
        ...manifests,
        "packages/config-eslint": `npm:typescript@${catalog}`,
      },
    }),
    /not older/,
  );
});

/**
 * The workspaces with a `lint` script, and those of them that have no ESLint
 * config of their own, as `group/name` strings. ESLint 10 looks a file's config up from the file's
 * own directory rather than from the working directory (`D21.2`), so a
 * workspace without one would be linted by whichever config sits above it —
 * or by none.
 */
const lintedWithoutConfig = async (root) => {
  const linted = [];
  const missing = [];
  for (const group of ["apps", "packages"]) {
    const entries = await readdir(path.join(root, group), {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, group, entry.name);
      const manifest = await readFile(path.join(dir, "package.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (!manifest?.scripts?.lint) continue;
      linted.push(`${group}/${entry.name}`);
      const files = await readdir(dir);
      if (!files.some((file) => /^eslint\.config\.[cm]?[jt]s$/.test(file)))
        missing.push(`${group}/${entry.name}`);
    }
  }
  return { linted, missing };
};

test("every linted workspace owns its config", async () => {
  // The walk has to find the tree before its empty answer means anything.
  const { linted, missing } = await lintedWithoutConfig(repoRoot);
  assert.ok(linted.includes("apps/api"), String(linted));
  assert.deepEqual(missing, []);

  // The predicate itself: a linted workspace without a config is reported,
  // and one without a `lint` script is not asked for one.
  const scratch = await mkdtemp(path.join(tmpdir(), "lint-config-"));
  try {
    const workspace = async (name, scripts, config) => {
      const dir = path.join(scratch, "packages", name);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name, scripts }),
      );
      if (config)
        await writeFile(path.join(dir, config), "export default [];\n");
    };
    await workspace("owned", { lint: "eslint ." }, "eslint.config.js");
    await workspace("orphan", { lint: "eslint ." });
    await workspace("unlinted", { build: "tsc" });
    assert.deepEqual(await lintedWithoutConfig(scratch), {
      linted: ["packages/orphan", "packages/owned"],
      missing: ["packages/orphan"],
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

/**
 * The leading `--` comment block of a migration, which is where ADR-0060 §5
 * asks the lock behaviour to be written down.
 */
const leadingComment = (sql) => {
  const lines = [];
  for (const line of sql.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.startsWith("--")) break;
    lines.push(line);
  }
  return lines.join("\n");
};

/** Whether that block says what the migration locks, or that it blocks nothing. */
const hasLockNote = (sql) =>
  /\b(locks?|block|blocks|blocking)\b/i.test(leadingComment(sql));

/**
 * The migrations the rule reaches, and the two it cannot. `0011` and `0012`
 * shipped without the note — `0011` is a bare generated file, `0012` a
 * backfill whose header speaks to idempotency and not to locks. Committed
 * migrations are never edited (ADR-0008), so they are named here rather than
 * fixed; the list is closed, and every later file carries its note.
 */
const LOCK_NOTE_FROM = 11;
const LOCK_NOTE_PREDATES = new Set([
  "0011_organizations.sql",
  "0012_backfill_personal_organizations.sql",
]);

test("every migration from 0011 on opens with its lock note", async () => {
  // DB-12: ADR-0060 §5 asks every migration to say whether it blocks, and the
  // rule had no check behind it — `0011` shipped without one and nothing said
  // so. The predicate is deliberately loose (the note's wording is the
  // author's), but a migration whose opening comment never mentions locking
  // or blocking has not made the choice §5 asks it to make.
  const dir = path.join(repoRoot, "packages", "db", "migrations");
  const files = (await readdir(dir))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .filter((name) => Number(name.slice(0, 4)) >= LOCK_NOTE_FROM)
    .sort();

  assert.ok(files.length > LOCK_NOTE_PREDATES.size, "no migrations to check");
  for (const name of LOCK_NOTE_PREDATES) {
    assert.ok(files.includes(name), `${name} is exempt but does not exist`);
  }

  const missing = [];
  for (const name of files) {
    if (LOCK_NOTE_PREDATES.has(name)) continue;
    if (!hasLockNote(await readFile(path.join(dir, name), "utf8"))) {
      missing.push(name);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `open these migrations with an ADR-0060 §5 lock note: ${missing.join(", ")}`,
  );

  // The predicate itself: a generated file with no header is caught, a note
  // below the first statement does not count, and either shape of note passes.
  const bare = 'CREATE INDEX "x" ON "t" ("c");';
  assert.equal(hasLockNote(bare), false);
  assert.equal(hasLockNote(`${bare}\n-- takes a SHARE lock`), false);
  assert.equal(
    hasLockNote(`-- Nothing here is expected to block.\n${bare}`),
    true,
  );
  assert.equal(
    hasLockNote(`-- Holds a SHARE lock for the build.\n${bare}`),
    true,
  );
});

test("no tsconfig writes its buildinfo into a cached output", async () => {
  // CI-07, and the same species as CI-01 and CI-02: a link of the gate that
  // ran without checking anything. `check-types` cached `dist-types/**`, and
  // the three apps kept `tsc -b`'s incremental state inside it. An app emits
  // no declarations (ADR-0062 §3), so that directory held the marker and
  // nothing else — restore it and the compiler reads "nothing to do" and exits
  // `0`, which Turborepo then caches as a green. `apps/admin` sat red on seven
  // errors under a replayed green until a dependency invalidated the cache.
  // The rule (ADR-0073 §6): a cached task's restored outputs must not be able
  // to decide the task's own result.
  //
  // A package is the exception the rule states rather than an oversight. Its
  // `dist-types/` is the declaration emit, and ADR-0062 §3 requires a consumer
  // to find every reference already up to date — `tsc -b` treats a composite
  // project whose buildinfo is missing as out of date and rebuilds it, which
  // would be one package's task writing into another's directory. So a
  // buildinfo may sit under a cached output only where the emit sits with it.
  const turboFiles = ["turbo.json"];
  const configs = [];
  for (const group of ["apps", "packages"]) {
    for (const entry of await readdir(path.join(repoRoot, group), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const read = (name) =>
        readFile(path.join(repoRoot, group, entry.name, name), "utf8").catch(
          () => null,
        );
      if ((await read("turbo.json")) !== null)
        turboFiles.push(`${group}/${entry.name}/turbo.json`);
      const text = await read("tsconfig.json");
      if (text === null) continue;
      configs.push({
        rel: `${group}/${entry.name}/tsconfig.json`,
        config: parseJsonc(text),
      });
    }
  }

  // Every directory the task's cache restores anywhere in the repository: the
  // root task table and each workspace's own `turbo.json`, which is where this
  // repository puts per-package task configuration. The union rather than the
  // entry that governs one workspace — a project that opts out of caching
  // outputs today is one edit away from opting back in, and the place a
  // compiler keeps its memory should not depend on that.
  const cached = [
    ...new Set(
      (
        await Promise.all(
          turboFiles.map(async (rel) =>
            parseJsonc(await readFile(path.join(repoRoot, rel), "utf8")),
          ),
        )
      ).flatMap((turbo) =>
        Object.entries(turbo.tasks ?? {})
          .filter(([task]) => task.replace(/^.*#/, "") === "check-types")
          .filter(([, task]) => task.cache !== false)
          .flatMap(([, task]) => task.outputs ?? [])
          .filter((glob) => !glob.startsWith("!"))
          .map(cachedDir),
      ),
    ),
  ];
  // Since `D29.5` no `check-types` entry restores anything — a package's task
  // is uncached, an app's caches no output (ADR-0078 §6) — so the union is
  // empty and the walk below is the guard for the day one opts back in. What
  // must still be true is that the task table was read at all.
  assert.ok(
    (
      await Promise.all(
        turboFiles.map(async (rel) =>
          parseJsonc(await readFile(path.join(repoRoot, rel), "utf8")),
        ),
      )
    ).some((turbo) => turbo.tasks?.["check-types"] !== undefined),
    "no `check-types` task read from any `turbo.json`",
  );
  assert.ok(
    turboFiles.length > 1,
    "no workspace `turbo.json` read — per-package outputs would be invisible",
  );

  // A renamed workspace root, or a `tsconfig.json` this walk cannot parse,
  // would make the assertions below pass by reading nothing at all.
  assert.ok(configs.length > 10, `only ${configs.length} tsconfigs read`);
  assert.ok(
    configs.some(({ config }) => !config.compilerOptions?.outDir),
    "no project checks without emitting — the shape the rule exists for",
  );

  // `rootDir` moves TypeScript's default buildinfo path out of `outDir`, and
  // `buildInfoOf` does not model that. Nothing sets one; the day something
  // does, this fails loudly rather than excusing a path it computed wrongly.
  assert.deepEqual(
    configs
      .filter(({ config }) => config.compilerOptions?.rootDir !== undefined)
      .map(({ rel }) => rel),
    [],
  );

  assert.deepEqual(
    configs
      .map(({ rel, config }) => decidesItsOwnResult(rel, config, cached))
      .filter(Boolean),
    [],
  );

  // And the rule fires on the shapes it exists for, or "clean" above means
  // only that nothing was checked.
  const fires = (config) =>
    decidesItsOwnResult("apps/x/tsconfig.json", config, ["dist-types"]);
  const composite = "@repo/typescript-config/composite.json";
  assert.ok(
    fires({ compilerOptions: { tsBuildInfoFile: "dist-types/x.tsbuildinfo" } }),
  );
  // An `outDir` named by a project that emits nothing is the same defect
  // spelled differently: the cache restores the marker and nothing else.
  assert.ok(fires({ compilerOptions: { outDir: "dist-types" } }));
  assert.equal(
    fires({
      extends: ["@repo/typescript-config/node.json", composite],
      compilerOptions: { outDir: "dist-types" },
    }),
    null,
  );
  assert.equal(
    fires({ compilerOptions: { tsBuildInfoFile: "tsconfig.tsbuildinfo" } }),
    null,
  );
});

/**
 * The `check-types` entry Turborepo runs for one workspace: the root task
 * table's, with the workspace's own `turbo.json` laid over it key by key —
 * which is how `extends: ["//"]` resolves.
 */
const checkTypesTaskOf = async (workspace) => {
  const read = (rel) => readFile(path.join(repoRoot, rel), "utf8");
  const root = parseJsonc(await read("turbo.json")).tasks?.["check-types"];
  const own = await read(`${workspace}/turbo.json`).then(
    (text) => parseJsonc(text).tasks?.["check-types"] ?? {},
    () => ({}),
  );
  return { ...root, ...own };
};

/** What a cache hit on that task writes back — nothing, when it is uncached. */
const restoredGlobs = (task) =>
  task.cache === false ? [] : (task.outputs ?? []);

/** One Turborepo output glob as a matcher over workspace-relative paths. */
const globToRegExp = (glob) => {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (ch === "*") source += "[^/]*";
    else if (ch === "?") source += "[^/]";
    else source += ch.replace(/[.+^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
};

/** Turborepo's reading of an `outputs` list: any inclusion, no exclusion. */
const restoresPath = (globs) => {
  const include = globs.filter((g) => !g.startsWith("!")).map(globToRegExp);
  const exclude = globs
    .filter((g) => g.startsWith("!"))
    .map((g) => globToRegExp(g.slice(1)));
  return (rel) =>
    include.some((re) => re.test(rel)) && !exclude.some((re) => re.test(rel));
};

/**
 * `D20.12`'s two commands, on a scratch copy of one composite package: warm
 * the compiler, keep what a cache hit on `check-types` would write back, put a
 * type error in a source file, write the kept files back **after** it — which
 * is what a restore does, and why its files are newer than every source — and
 * run `tsc -b` again. The second compile's exit status is the answer. The
 * timestamps are set rather than waited for, so the order is exact on any
 * filesystem's clock resolution.
 */
const maskExperiment = async (workspace, globs) => {
  const source = path.join(repoRoot, workspace);
  const scratch = await mkdtemp(path.join(tmpdir(), "restored-buildinfo-"));
  try {
    await cp(source, scratch, {
      recursive: true,
      filter: (from) =>
        !/(?:^|[\\/])(?:node_modules|dist|dist-types|coverage|\.turbo)$/.test(
          path.relative(source, from),
        ),
    });
    await symlink(
      path.join(source, "node_modules"),
      path.join(scratch, "node_modules"),
      "junction",
    );
    const typescript = path.join(source, "node_modules/typescript");
    const manifest = JSON.parse(
      await readFile(path.join(typescript, "package.json"), "utf8"),
    );
    const tsc = path.join(
      typescript,
      typeof manifest.bin === "string" ? manifest.bin : manifest.bin.tsc,
    );
    const compile = () =>
      spawnSync(process.execPath, [tsc, "-b"], {
        cwd: scratch,
        encoding: "utf8",
      });
    const files = async () =>
      (await readdir(scratch, { recursive: true }))
        .map(posix)
        .filter((rel) => !under(rel, "node_modules"));

    const warm = compile();
    assert.equal(warm.status, 0, `${workspace}: ${warm.stdout}${warm.stderr}`);

    const matches = restoresPath(globs);
    const kept = new Map();
    for (const rel of (await files()).filter(matches)) {
      const abs = path.join(scratch, rel);
      if ((await stat(abs)).isFile()) kept.set(rel, await readFile(abs));
    }

    const victim = (await files())
      .filter((rel) => /\.tsx?$/.test(rel) && !/\.d\.ts$/.test(rel))
      .filter((rel) => !rel.startsWith("dist-types/"))
      .sort()[0];
    assert.ok(victim, `${workspace}: no source file to break`);
    const now = Date.now() / 1000;
    await appendFile(
      path.join(scratch, victim),
      '\nexport const restoredBuildinfoProbe: number = "not a number";\n',
    );
    await utimes(path.join(scratch, victim), now + 10, now + 10);
    for (const [rel, bytes] of kept) {
      await writeFile(path.join(scratch, rel), bytes);
      await utimes(path.join(scratch, rel), now + 20, now + 20);
    }

    const second = compile();
    return {
      status: second.status,
      output: `${second.stdout}${second.stderr}`,
      restored: [...kept.keys()].sort(),
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

test("a package's restored buildinfo cannot mask its own error", async () => {
  // ADR-0073 §6's residual, which ADR-0078 §6 decides. The case above keeps a
  // buildinfo out of any cached output unless its emit sits with it — and that
  // exception is the hole: a composite package's `dist-types/` is its emit and
  // its compiler's memory together, so a cache hit that restored it after an
  // edit told `tsc -b` there was nothing to do, and the task exited `0` over a
  // type error in that package (`D20.12`, on `@repo/logger`; the same on
  // TypeScript 7, `D21.6`). This case runs the experiment itself, for every
  // shape of `check-types` entry a composite package resolves to, on a scratch
  // copy of the one package with no references — the experiment's outcome
  // depends on what is restored and on the compiler, not on the package.
  //
  // What makes it green is decided in ADR-0078 §6: a package's `check-types`
  // is uncached, so nothing is restored and the compiler's memory is only ever
  // its own. The other candidate, the emit cached without its buildinfo, also
  // passes this case — and fails ADR-0062 §3 instead, because a consumer's
  // `tsc -b` then finds a reference with no buildinfo and rebuilds it into the
  // package's directory; the record carries that measurement.
  const packages = [];
  for (const entry of await readdir(path.join(repoRoot, "packages"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const workspace = `packages/${entry.name}`;
    const text = await readFile(
      path.join(repoRoot, workspace, "tsconfig.json"),
      "utf8",
    ).catch(() => null);
    if (text === null) continue;
    const config = parseJsonc(text);
    if (!emits(config)) continue;
    packages.push({
      workspace,
      config,
      restored: restoredGlobs(await checkTypesTaskOf(workspace)),
    });
  }
  assert.ok(packages.length > 10, `only ${packages.length} packages read`);

  const leaf = packages.find(
    ({ config }) => (config.references ?? []).length === 0,
  );
  assert.ok(leaf, "no composite package without references to copy");

  const shapes = new Map();
  for (const { workspace, restored } of packages) {
    const key = JSON.stringify(restored);
    shapes.set(key, [...(shapes.get(key) ?? []), workspace]);
  }

  const masked = [];
  for (const [key, workspaces] of shapes) {
    const run = await maskExperiment(leaf.workspace, JSON.parse(key));
    if (run.status === 0)
      masked.push(
        `${workspaces.join(", ")}: restoring ${run.restored.join(", ")} exits 0 over a type error`,
      );
  }
  assert.deepEqual(masked, []);

  // And the experiment still reproduces what it exists for, or "clean" above
  // means only that the compiler changed: the shape the packages had until
  // `D29.5` masks the error, and restoring nothing reports it.
  const before = await maskExperiment(leaf.workspace, ["dist-types/**"]);
  assert.equal(
    before.status,
    0,
    "restoring `dist-types/**` no longer masks the error — this case proves nothing until the experiment is rebuilt",
  );
  assert.ok(before.restored.some((rel) => rel.endsWith(".tsbuildinfo")));
  const nothing = await maskExperiment(leaf.workspace, []);
  assert.notEqual(nothing.status, 0);
  assert.match(nothing.output, /TS2322/);
  assert.deepEqual(
    [
      "dist-types/tsconfig.tsbuildinfo",
      "dist-types/src/index.d.ts",
      "src/index.ts",
    ].filter(restoresPath(["dist-types/**", "!dist-types/**/*.tsbuildinfo"])),
    ["dist-types/src/index.d.ts"],
  );
});

/** A Content-Security-Policy string as a directive → sources map. */
const directivesOf = (policy) =>
  Object.fromEntries(
    policy
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name, sources.join(" ")];
      }),
  );

test("both SPA images send the policy, and the same one", async () => {
  // The two nginx configurations are copies of each other by construction
  // (ADR-0059 §4), and the policy (ADR-0073 §9) is the one line where a
  // loosening in one file and not the other would be invisible — a build
  // succeeds, the app works, and one origin quietly runs without the
  // directive that stops script injection. What the policy must say is read
  // rather than diffed: `script-src 'self'` and `frame-ancestors 'none'` are
  // the two directives the finding was about, the header is `always` so an
  // error page carries it too, and `connect-src` names the placeholder the
  // Dockerfile fills in from `VITE_API_URL` — a file that stopped naming it
  // would ship an image whose policy blocks its own API.
  const read = (rel) => readFile(path.join(repoRoot, rel), "utf8");
  const policies = {};

  for (const app of ["admin", "customer"]) {
    const conf = await read(`apps/${app}/nginx.conf`);
    const lines = conf
      .split(/\r?\n/)
      .filter((line) =>
        /^\s*add_header\s+Content-Security-Policy\s/.test(line),
      );
    assert.equal(
      lines.length,
      1,
      `apps/${app}/nginx.conf: one Content-Security-Policy, found ${lines.length}`,
    );

    const match =
      /^\s*add_header\s+Content-Security-Policy\s+"([^"]+)"\s+always;\s*$/.exec(
        lines[0],
      );
    assert.ok(
      match,
      `apps/${app}/nginx.conf: the policy is one quoted value sent \`always\``,
    );

    const directives = directivesOf(match[1]);
    assert.equal(directives["script-src"], "'self'", `apps/${app}: script-src`);
    assert.equal(
      directives["frame-ancestors"],
      "'none'",
      `apps/${app}: frame-ancestors`,
    );
    assert.equal(
      directives["default-src"],
      "'self'",
      `apps/${app}: default-src`,
    );
    assert.equal(directives["object-src"], "'none'", `apps/${app}: object-src`);
    assert.ok(
      directives["connect-src"]?.split(" ").includes("__API_ORIGIN__"),
      `apps/${app}: connect-src carries the placeholder the Dockerfile fills`,
    );

    const dockerfile = await read(`apps/${app}/Dockerfile`);
    assert.ok(
      dockerfile.includes("__API_ORIGIN__"),
      `apps/${app}/Dockerfile: substitutes the placeholder`,
    );

    policies[app] = match[1];
  }

  assert.equal(
    policies.admin,
    policies.customer,
    "the two images' policies have drifted apart",
  );
});

/**
 * A Dockerfile as its stages, each the list of its instructions with line
 * continuations joined and comments dropped — `FROM` opens a stage.
 */
const dockerStages = (text) => {
  const instructions = text
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [, keyword, rest] = /^(\S+)\s*(.*)$/.exec(line);
      return { keyword: keyword.toUpperCase(), rest };
    });
  const stages = [];
  for (const instruction of instructions) {
    if (instruction.keyword === "FROM") stages.push([]);
    stages.at(-1)?.push(instruction);
  }
  return stages;
};

test("the SPA images run unprivileged with a health check", async () => {
  // CI-05 (ADR-0078 §5, a delta on ADR-0059 §4). The stock nginx image starts
  // its master process as root to bind port 80; the unprivileged one runs as
  // uid 101 from the start, which moves the port above 1024. Four files have
  // to agree on that number — `nginx.conf`'s `listen`, the Dockerfile's
  // `EXPOSE` and `HEALTHCHECK`, and the compose file's mapping — and a drift
  // between any two is an image that builds, starts and answers nothing, so
  // the case reads all four rather than trusting one.
  const read = (rel) => readFile(path.join(repoRoot, rel), "utf8");
  const compose = await read("docker/prod/compose.yaml");

  for (const app of ["admin", "customer"]) {
    const where = `apps/${app}/Dockerfile`;
    const runtime = dockerStages(await read(where)).at(-1);
    const of = (keyword) => runtime.filter((i) => i.keyword === keyword);

    assert.match(
      of("FROM")[0].rest,
      /^nginxinc\/nginx-unprivileged:\S+/,
      `${where}: the runtime stage is the unprivileged nginx image`,
    );
    const user = of("USER").at(-1)?.rest;
    assert.ok(user, `${where}: the runtime stage states its user`);
    assert.doesNotMatch(user, /^(?:root|0)(?::|$)/, `${where}: USER ${user}`);

    const conf = await read(`apps/${app}/nginx.conf`);
    const ports = [
      ...new Set(
        [...conf.matchAll(/^\s*listen\s+(?:\[::\]:)?(\d+)\b/gm)].map(
          (m) => m[1],
        ),
      ),
    ];
    assert.equal(ports.length, 1, `apps/${app}/nginx.conf listens on ${ports}`);
    const [port] = ports;
    assert.ok(Number(port) >= 1024, `apps/${app}/nginx.conf: port ${port}`);

    assert.deepEqual(
      of("EXPOSE").map((i) => i.rest),
      [port],
      `${where}: EXPOSE ${port}`,
    );

    const health = of("HEALTHCHECK");
    assert.equal(health.length, 1, `${where}: one HEALTHCHECK`);
    assert.doesNotMatch(health[0].rest, /^NONE\b/);
    const url = /https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)(\/[^\s"]*)/.exec(
      health[0].rest,
    );
    assert.ok(url, `${where}: the health check polls the server itself`);
    assert.equal(url[1], port, `${where}: the health check's port`);
    assert.match(
      conf,
      new RegExp(
        `location\\s*=\\s*${url[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
      ),
      `apps/${app}/nginx.conf answers ${url[2]} in a location of its own`,
    );

    const mapping = new RegExp(
      `\\$\\{${app.toUpperCase()}_PORT:-\\d+\\}:(\\d+)"`,
    ).exec(compose);
    assert.ok(mapping, `docker/prod/compose.yaml maps the ${app} port`);
    assert.equal(mapping[1], port, `docker/prod/compose.yaml: ${app}'s target`);
  }
});

test("every image fetches from the lockfile before the source is copied", async () => {
  // CI-10 (ADR-0078 §5). An install after `COPY . .` downloads the whole
  // dependency tree on every source edit, because that copy is the layer an
  // edit invalidates. `pnpm fetch` reads the lockfile alone, so the layer it
  // fills is rebuilt when a dependency moves; the install after the copy
  // links from the store `--offline`, which is also what proves nothing was
  // left for it to download. No `ARG` above the fetch: a build argument is
  // part of every later layer's key, and the SPA images take one per
  // environment.
  for (const app of ["api", "admin", "customer"]) {
    const where = `apps/${app}/Dockerfile`;
    const stages = dockerStages(
      await readFile(path.join(repoRoot, where), "utf8"),
    );
    const build = stages.find((stage) =>
      stage.some((i) => i.keyword === "COPY" && /^\.\s+\.$/.test(i.rest)),
    );
    assert.ok(build, `${where}: no stage copies the source`);
    const at = (predicate) => build.findIndex(predicate);

    const source = at((i) => i.keyword === "COPY" && /^\.\s+\.$/.test(i.rest));
    const lockfile = at(
      (i) =>
        i.keyword === "COPY" &&
        i.rest.split(/\s+/).includes("pnpm-lock.yaml") &&
        !i.rest.split(/\s+/).includes("."),
    );
    const fetch = at(
      (i) => i.keyword === "RUN" && /\bpnpm fetch\b/.test(i.rest),
    );
    const install = at(
      (i) => i.keyword === "RUN" && /\bpnpm install\b/.test(i.rest),
    );

    assert.ok(lockfile >= 0, `${where}: the lockfile is copied on its own`);
    assert.ok(fetch > lockfile, `${where}: \`pnpm fetch\` follows it`);
    assert.ok(source > fetch, `${where}: the source is copied after the fetch`);
    assert.ok(install > source, `${where}: the install follows the source`);
    assert.match(build[install].rest, /--offline\b/, `${where}: --offline`);
    assert.match(build[install].rest, /--frozen-lockfile\b/, where);
    assert.equal(
      build.slice(0, fetch).filter((i) => i.keyword === "ARG").length,
      0,
      `${where}: no build argument above the fetch`,
    );
  }
});

test("every service in the reference deployment states its limits and a bounded log", async () => {
  // CI-11 (ADR-0078 §5, a delta on ADR-0059 §6). `docker compose config` is
  // what renders them; this reads the file for the two facts that make them
  // mean something — every service carries both, and the log driver the
  // services share is bounded, since `json-file` alone grows until the disk
  // is full.
  //
  // Line endings are normalised first (`D32.1`): the patterns below are
  // written against `\n`, and a Windows checkout under `core.autocrlf=true`
  // has `\r\n`, which failed every service on a tree that was correct.
  const compose = (
    await readFile(path.join(repoRoot, "docker/prod/compose.yaml"), "utf8")
  ).replace(/\r\n/g, "\n");
  const services = compose.slice(compose.search(/^services:\s*$/m));
  const end = services.search(/\n(?=\S)/);
  const body = end === -1 ? services : services.slice(0, end + 1);
  const blocks = body
    .split(/^ {2}(?=[\w-]+:\s*$)/m)
    .slice(1)
    .map((block) => ({ name: /^([\w-]+):/.exec(block)[1], block }));
  assert.deepEqual(blocks.map(({ name }) => name).sort(), [
    "admin",
    "api",
    "customer",
    "migrate",
    "prune",
  ]);
  for (const { name, block } of blocks) {
    assert.match(block, /^ {4}logging: \*logging\s*$/m, `${name}: logging`);
    assert.match(
      block,
      /^ {4}deploy:\n {6}resources:\n {8}limits:\n(?: {10}\w+: .+\n)*? {10}memory: \S+/m,
      `${name}: a memory limit`,
    );
    assert.match(
      block,
      /^ {8}limits:\n(?: {10}\w+: .+\n)*? {10}cpus: \S+/m,
      `${name}: a CPU limit`,
    );
  }
  const anchor = /^x-logging: &logging\n((?: {2}.*\n)+)/m.exec(compose);
  assert.ok(anchor, "the shared log driver is one anchor");
  assert.match(anchor[1], /driver: json-file/);
  assert.match(anchor[1], /max-size: "\d+[kmg]"/);
  assert.match(anchor[1], /max-file: "\d+"/);
});

/**
 * The workspaces whose `dist/` the API image carries, read off the
 * Dockerfile's `cp -R /repo/<workspace>/dist… /out/dist…` lines — so a third
 * bundle copied in later is scanned without this file being told.
 */
const imageDistSources = (dockerfile) =>
  [
    ...dockerfile.matchAll(
      /\bcp\s+-R\s+\/repo\/((?:apps|packages)\/[\w-]+)\/dist\S*\s+\/out\/dist\b/g,
    ),
  ].map((match) => match[1]);

/**
 * Whether a built file carries `dotenv`: inlined, it brings its own
 * `DOTENV_*` switches (every release from 16 to 18 reads them); kept external,
 * it is an import or a require of the specifier.
 */
const carriesDotenv = (text) =>
  /\bDOTENV_(?:[A-Z]|\$\{)/.test(text) ||
  /(?:\bfrom\s*|\bimport\s*\(\s*|(?:\b|__)require\s*\(\s*|\bimport\s+)["']dotenv(?:\/[^"']*)?["']/.test(
    text,
  );

test("the API image's dist/ carries no dotenv", async () => {
  // ADR-0004: "No `dotenv` in production builds". The API's own bundle keeps
  // its dependencies external and never imported it, but `@repo/db`'s
  // migrate and prune bundles inline their whole closure and are copied into
  // the same `/app/dist` — so since `D14.3` the rule was untrue for the
  // image, through `tooling/env.ts`. `D21.4` moved that loader to Node's
  // `process.loadEnvFile`; this case builds every bundle the Dockerfile
  // copies, into a scratch directory, and reads what would ship.
  const dockerfile = await readFile(
    path.join(repoRoot, "apps/api/Dockerfile"),
    "utf8",
  );
  const sources = imageDistSources(dockerfile);
  assert.deepEqual(
    [...sources].sort(),
    ["apps/api", "packages/db"],
    "the image's dist/ sources",
  );

  const scratch = await mkdtemp(path.join(tmpdir(), "image-dist-"));
  try {
    const carrying = [];
    for (const source of sources) {
      const cwd = path.join(repoRoot, source);
      const tsdown = JSON.parse(
        await readFile(
          path.join(cwd, "node_modules/tsdown/package.json"),
          "utf8",
        ),
      );
      const bin = path.join(
        cwd,
        "node_modules/tsdown",
        typeof tsdown.bin === "string" ? tsdown.bin : tsdown.bin.tsdown,
      );
      const outDir = path.join(scratch, source.replace("/", "-"));
      const built = spawnSync(process.execPath, [bin, "--out-dir", outDir], {
        cwd,
        encoding: "utf8",
      });
      assert.equal(built.status, 0, `${source}: ${built.stderr}`);

      // Recursive: `cp -R` ships the whole tree, so a nested chunk ships too.
      const files = (await readdir(outDir, { recursive: true })).filter(
        (file) => /\.[cm]?js$/.test(file),
      );
      assert.ok(files.length > 0, `${source}: built nothing`);
      for (const file of files) {
        if (carriesDotenv(await readFile(path.join(outDir, file), "utf8")))
          carrying.push(`${source}/dist/${file}`);
      }
    }
    assert.deepEqual(carrying, []);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  // The predicates themselves: both shapes of a bundle that carries it are
  // caught, prose naming it is not, and the Dockerfile's copy lines are read.
  assert.ok(carriesDotenv("const o = process.env.DOTENV_CONFIG_PATH;"));
  assert.ok(carriesDotenv('import { config } from "dotenv";'));
  assert.ok(carriesDotenv("import 'dotenv/config';"));
  assert.ok(carriesDotenv('const d = require("dotenv");'));
  // rolldown's shim for an external required from inlined CommonJS.
  assert.ok(carriesDotenv('const d = __require("dotenv");'));
  // dotenv 18's minified build names its switches with a template.
  assert.ok(carriesDotenv("const k = `DOTENV_${t}`;"));
  assert.ok(carriesDotenv('await import("dotenv")'));
  assert.ok(!carriesDotenv("/** ADR-0004: No `dotenv` in production. */"));
  assert.deepEqual(
    imageDistSources(
      "cp -R /repo/apps/api/dist /out/dist \\\n && cp -R /repo/packages/db/dist/. /out/dist/ \\\n && cp -R /repo/packages/db/migrations /out/migrations",
    ),
    ["apps/api", "packages/db"],
  );
});

// The behaviour specs (ADR-0068 §1): the real ones are clean, the scan
// reaches them, and each shape rule fires on the text it exists for.
test("the behaviour specs are clean", async () => {
  const violations = await scanSpecs();
  assert.deepEqual(
    violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.found}`),
    [],
  );
});

test("the spec scan covers docs/specs and skips its README", async () => {
  const files = (await specDocuments()).map((f) => f.rel);
  assert.ok(files.length > 0);
  assert.ok(files.every((f) => f.startsWith("docs/specs/")));
  assert.ok(!files.includes("docs/specs/README.md"));
});

const always = () => true;
const never = () => false;

const SPEC = `# X

## Requirement: A thing
It answers.
Records: [ADR-0012](../adr/0012-response-envelope.md)
Proved by: \`apps/api/test/envelope.int.test.ts\`

### Scenario: The case
- **WHEN** a client asks
- **THEN** it answers
`;

test("a well-formed spec passes", () => {
  assert.deepEqual(rules(checkSpec("s.md", SPEC, always)), []);
});

test("a requirement without a scenario is caught", () => {
  const text = SPEC.replace(/### Scenario:[\s\S]*$/, "");
  assert.deepEqual(rules(checkSpec("s.md", text, always)), [
    "spec-no-scenario",
  ]);
});

test("a scenario without a THEN is caught", () => {
  const text = SPEC.replace("- **THEN** it answers\n", "");
  assert.deepEqual(rules(checkSpec("s.md", text, always)), [
    "spec-scenario-shape",
  ]);
});

test("a scenario without a WHEN is caught", () => {
  const text = SPEC.replace("- **WHEN** a client asks\n", "");
  assert.deepEqual(rules(checkSpec("s.md", text, always)), [
    "spec-scenario-shape",
  ]);
});

test("a record or a test that does not exist is caught", () => {
  assert.deepEqual(rules(checkSpec("s.md", SPEC, never)), [
    "spec-record-missing",
    "spec-test-missing",
  ]);
});

test("a requirement with no Records: or Proved by: line is caught", () => {
  const text = SPEC.replace(/^Records:.*\n/m, "").replace(
    /^Proved by:.*\n/m,
    "",
  );
  assert.deepEqual(rules(checkSpec("s.md", text, always)), [
    "spec-record-missing",
    "spec-test-missing",
  ]);
});

test("a file with no requirement is caught", () => {
  assert.deepEqual(rules(checkSpec("s.md", "# Empty\n", always)), [
    "spec-empty",
  ]);
});

// The open lanes (ADR-0079 §1–§3): the committed ledger's lanes are disjoint,
// and each lane rule fires on the fixture it exists for.
test("the committed ledger's open lanes are disjoint", async () => {
  const { violations } = await scanLanes();
  assert.deepEqual(
    violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.found}`),
    [],
  );
});

const lane = (n, records, schema = "no") =>
  `- **Lane [D${n}](00${n}-x.md)** — opened 2026-09-29 · records ${records
    .map((r) => `[${r}](../adr/${r}-x.md)`)
    .join(", ")} · schema: ${schema}`;

// The table marks `in progress` every deliverable an entry names, unless a
// case passes its own rows.
const rowsFor = (entries) =>
  [...new Set(entries.map((e) => e.match(/\[(D\d+)\]/)?.[1]).filter(Boolean))]
    .map((d) => `| [${d}](x.md) | T | **in progress** | x |`)
    .join("\n");

const ledger = (...entries) => ledgerWith(rowsFor(entries), entries);

const ledgerWith = (rows, entries, heading = "**Open lanes:**") => `# Ledger

| # | Title | Status | Scope |
| - | ----- | ------ | ----- |
| D2 | Old | **shipped 2026-01-01** | x |
${rows}

## Rules

- **Lane [D1](0001-x.md)** — not in the window section, never read

## The window

Preamble.

${heading}

${entries.join("\n")}

The running paragraph, which is not a lane.

- A list after the paragraph is not a lane either.

## Executing a step
`;

test("one open lane reads as before", () => {
  const text = ledger(lane(30, ["0079", "0025"]));
  const { lanes, malformed } = parseLanes(text);
  assert.deepEqual(malformed, []);
  assert.deepEqual(
    lanes.map((l) => [l.deliverable, l.opened, l.records, l.schema]),
    [["D30", "2026-09-29", ["0079", "0025"], false]],
  );
  assert.deepEqual(rules(checkLanes("l.md", text)), []);
});

test("two open lanes never share a record", () => {
  const disjoint = ledger(
    lane(29, ["0078", "0018"], "yes"),
    lane(31, ["0080", "0062"]),
  );
  assert.deepEqual(rules(checkLanes("l.md", disjoint)), []);

  const shared = ledger(lane(29, ["0078", "0018"]), lane(31, ["0080", "0018"]));
  const violations = checkLanes("l.md", shared);
  assert.deepEqual(rules(violations), ["lane-shared-record"]);
  assert.equal(violations[0].found, "0018");
});

test("a second lane on the schema is refused", () => {
  const text = ledger(
    lane(29, ["0078"], "yes"),
    lane(31, ["0080"], "yes"),
    lane(32, ["0081"]),
  );
  const violations = checkLanes("l.md", text);
  assert.deepEqual(rules(violations), ["lane-second-schema"]);
  assert.equal(violations[0].found, "D31");
});

test("a lane entry that does not parse is refused, not skipped", () => {
  const text = ledger(
    lane(30, ["0079"]),
    "- **Lane D31** — opened 2026-09-29 · records 0079 · schema: no",
  );
  assert.deepEqual(rules(checkLanes("l.md", text)), ["lane-malformed"]);
});

test("a record not written as a matching link is refused", () => {
  const bare = ledger(
    lane(29, ["0078"]).replace(" · schema", ", 0018 · schema"),
    lane(31, ["0018"]),
  );
  // The refused entry is not a lane, so its row is also missing one.
  assert.deepEqual(rules(checkLanes("l.md", bare)), [
    "lane-missing",
    "lane-malformed",
  ]);
  const mislabelled = ledger(lane(30, ["0079"]).replace("[0079]", "[0080]"));
  assert.deepEqual(rules(checkLanes("l.md", mislabelled)), [
    "lane-missing",
    "lane-malformed",
  ]);
});

test("an indented line inside the list is refused, and lanes after it are read", () => {
  const text = ledger(
    lane(29, ["0018"], "yes"),
    "  a note under the entry",
    lane(31, ["0018"], "yes"),
  );
  assert.deepEqual(rules(checkLanes("l.md", text)), [
    "lane-malformed",
    "lane-shared-record",
    "lane-second-schema",
  ]);
});

test("a deliverable in progress with no entry is refused, and so is an entry for one that is not", () => {
  const misspelt = ledgerWith(
    rowsFor([lane(29, ["0078"])]),
    [lane(29, ["0078"])],
    "**Open lanes**:",
  );
  assert.deepEqual(rules(checkLanes("l.md", misspelt)), ["lane-missing"]);
  const stale = ledgerWith("", [lane(29, ["0078"])]);
  assert.deepEqual(rules(checkLanes("l.md", stale)), ["lane-not-open"]);
});

test("a deliverable has one entry", () => {
  const text = ledger(lane(30, ["0079"]), lane(30, ["0025"], "yes"));
  assert.deepEqual(rules(checkLanes("l.md", text)), ["lane-duplicate"]);
});

test("a ledger with nothing in progress and no open-lanes list has no lanes", () => {
  const text = "# Ledger\n\n## The window\n\nNothing is open.\n";
  assert.deepEqual(parseLanes(text), {
    lanes: [],
    malformed: [],
    inProgress: [],
  });
  assert.deepEqual(rules(checkLanes("l.md", text)), []);
});

// The tag prefix (ADR-0081 §5): one line of the ledger's header names the
// namespace `/ship` tags in, so a fork's tags never meet the starter's.
test("the ledger names the tag prefix /ship writes", async () => {
  const text = await readFile(path.join(repoRoot, LEDGER), "utf8");
  const { violations, prefix } = await scanTagPrefix();
  assert.deepEqual(
    violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.found}`),
    [],
  );
  assert.match(prefix, /^[a-z][a-z0-9-]*$/);

  // Red with the line removed: a ledger that names no prefix is refused.
  const without = text
    .split(/\r?\n/)
    .filter((line) => !TAG_PREFIX_LINE.test(line.trimEnd()))
    .join("\n");
  assert.notEqual(without, text.replace(/\r\n/g, "\n"));
  assert.deepEqual(rules(checkTagPrefix(LEDGER, without)), [
    "tag-prefix-missing",
  ]);

  // And `/ship` is what reads it: the skill names the line and the tag shape.
  const ship = await readFile(
    path.join(repoRoot, ".claude/skills/ship/SKILL.md"),
    "utf8",
  );
  assert.ok(ship.includes("Tag prefix:"), "/ship names the ledger's line");
  assert.ok(ship.includes("<prefix>-D<n>"), "/ship tags `<prefix>-D<n>`");
});

const headed = (header) => `# Ledger

${header}

| # | Title | Status | Scope |
| - | ----- | ------ | ----- |

## The window

Tag prefix: \`below-the-header\`
`;

test("a tag prefix line that does not parse, or a second one, is refused", () => {
  assert.deepEqual(
    rules(checkTagPrefix("l.md", headed("Tag prefix: `acme`"))),
    [],
  );
  assert.deepEqual(parseTagPrefix(headed("Tag prefix: `acme`")).prefixes, [
    { line: 3, prefix: "acme" },
  ]);
  assert.deepEqual(
    rules(checkTagPrefix("l.md", headed("Tag prefix: `Acme Corp`"))),
    ["tag-prefix-malformed"],
  );
  assert.deepEqual(rules(checkTagPrefix("l.md", headed("Tag prefix: acme"))), [
    "tag-prefix-malformed",
  ]);
  // `v2-D1` would match `v[0-9]*`, the release label's tag pattern.
  assert.deepEqual(rules(checkTagPrefix("l.md", headed("Tag prefix: `v2`"))), [
    "tag-prefix-malformed",
  ]);
  assert.deepEqual(
    rules(checkTagPrefix("l.md", headed("Tag prefix: `vendor`"))),
    [],
  );
  assert.deepEqual(
    rules(
      checkTagPrefix(
        "l.md",
        headed("Tag prefix: `acme`\n\nTag prefix: `starter`"),
      ),
    ),
    ["tag-prefix-duplicate"],
  );
});

test("a tag prefix below the header is not the ledger's", () => {
  assert.deepEqual(rules(checkTagPrefix("l.md", headed("No prefix here."))), [
    "tag-prefix-missing",
  ]);
});

// The negative cases: each rule must actually fire on the text it exists for,
// or "clean" above means only that nothing was checked.
test("a step number is caught", () => {
  assert.deepEqual(rules(checkText("f.md", "Accepted at `D14.12`'s head.")), [
    "step-reference",
  ]);
});

test("a date is caught", () => {
  assert.deepEqual(
    rules(checkText("f.md", "Shipped 2026-09-02 with the ledger row.")),
    ["date"],
  );
});

test("a bare record range is caught", () => {
  assert.deepEqual(rules(checkText("f.md", "Condensed from ADRs 0030–0054.")), [
    "bare-range",
  ]);
  assert.deepEqual(rules(checkText("f.md", "ADRs 0001-0058 are frozen.")), [
    "bare-range",
  ]);
});

test("a window statement that does not link to the ledger is caught", () => {
  assert.deepEqual(
    rules(
      checkText("f.md", "The D14 window is open over the starter records."),
    ),
    ["unlinked-window"],
  );
  assert.deepEqual(rules(checkText("f.md", "No amendment window is open.")), [
    "unlinked-window",
  ]);
});

test("a window statement that links to the ledger passes", () => {
  assert.deepEqual(
    rules(
      checkText(
        "f.md",
        `Which window is open is stated in [the ledger](../docs/${LEDGER_WINDOW}).`,
      ),
    ),
    [],
  );
});

test("the window rule does not fire on the ordinary word", () => {
  assert.deepEqual(
    rules(checkText("f.md", "kept only for the grace window, then discarded")),
    [],
  );
  assert.deepEqual(
    rules(checkText("f.md", "Clear `window.localStorage` between tests.")),
    [],
  );
});

test("the placeholders the skills teach are not violations", () => {
  assert.deepEqual(
    rules(
      checkText("f.md", "Label it `**Amended YYYY-MM-DD (D<n>.<step>).**`"),
    ),
    [],
  );
  assert.deepEqual(
    rules(checkText("f.md", "The row moves to `shipped YYYY-MM-DD`.")),
    [],
  );
});
