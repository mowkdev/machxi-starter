import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LEDGER_WINDOW,
  checkSpec,
  checkText,
  inheritedDocuments,
  isExcluded,
  scan,
  scanSpecs,
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
 * The three trees the thousand-line ceiling covers: the API's feature modules
 * and the two platform packages whose entry files had grown into everything at
 * once. They are named rather than globbed because the ceiling is a claim
 * about *these* trees — a package that has never had the problem does not
 * silently inherit a rule nobody argued for.
 */
const LINE_CEILING_ROOTS = [
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

test("no tsconfig writes its buildinfo into a cached output", async () => {
  // CI-07, and the same species as CI-01 and CI-02: a link of the gate that
  // ran without checking anything. `check-types` caches `dist-types/**`, and
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
          .flatMap(([, task]) => task.outputs ?? [])
          .filter((glob) => !glob.startsWith("!"))
          .map(cachedDir),
      ),
    ),
  ];
  assert.ok(cached.length > 0, "`check-types` declares no cached outputs");
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
