#!/usr/bin/env node
// Generates `docs/rules/<area>.md` — the current-rules digests (ADR-0065 §5).
//
// The digest is DERIVED: this script owns the rule lines, the ADR corpus owns
// every citation. For each cited record the generator reads the record's own
// title and `- Status:` line, renders the citation with a topic gloss taken
// from the title, and refuses to emit a digest that cites a record which is out
// of force. `/ship` runs it as part of the sweep; `docs/rules/*.md` is never
// edited by hand.
//
// Usage:
//   node scripts/rules-digest.mjs           write the digests
//   node scripts/rules-digest.mjs --check   fail if any digest is out of date

import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * The rule lines, per area. `records` names the record each line comes from;
 * the generator turns an id into a glossed link and checks it is in force.
 */
export const AREAS = [
  {
    slug: "api-and-data",
    title: "API and data — the rules in force",
    loadWhen:
      "`apps/api`, `packages/contracts`, `packages/db`, `packages/crypto`, `packages/logger`",
    rules: [
      {
        topic: "Functional style, no OOP",
        records: ["0009"],
        text: "No `class`, no `this`, no decorators, no DI framework. Every layer is `create<Module><Layer>(deps)` returning an `as const` object; types come from `ReturnType`. Third-party constructors are wrapped in `create*` functions.",
      },
      {
        topic: "Layers",
        records: ["0009"],
        text: "`*.routes.ts` → `*.controller.ts` → `*.service.ts` → `*.repository.ts`. Services never import Express or SQL; repositories hold every Drizzle query; controllers read `req.valid`, call the service with `req.ctx` first, and answer through `respond.*`.",
      },
      {
        topic: "Envelope",
        records: ["0012"],
        text: "Controllers use `respond.ok / created / list / noContent` and nothing else; `res.json` appears only inside the API's own `core/http`.",
      },
      {
        topic: "Errors",
        records: ["0013"],
        text: "One branded `AppError`, thrown through factories (`notFound()`, `forbidden()`, a module's `*.errors.ts`) and matched with `isAppError(e)` plus `e.code` — never `instanceof`, never a new error class. The API's `message` is developer-facing English and is never rendered by a client. The handler reports 5xx through the reporting seam and the response shape does not widen.",
      },
      {
        topic: "Configuration",
        records: ["0004"],
        text: "`process.env` is read only in `apps/api/src/core/config`, `packages/db/src/tooling/env.ts`, `scripts/postman.mjs` and the API test harness. A new variable means a zod schema entry, an `.env.example` line and — when a task reads it — a `turbo.json` `env` entry.",
      },
      {
        topic: "Request context",
        records: ["0010"],
        text: "Services take `ctx: RequestContext` as their first parameter; `getContext()` belongs to infrastructure only.",
      },
      {
        topic: "Validation",
        records: ["0011", "0023"],
        text: "Zod schemas live in `@repo/contracts` and are re-exported by `<module>.schemas.ts`; controllers read `req.valid.{params,query,body}` and nothing else; bodies are `.strict()`.",
      },
      {
        topic: "Auth and guards",
        records: ["0017", "0019", "0057"],
        text: "Two populations — `staff` and `user` — with separate tables and separate segments `/api/v1/{public,user,admin}`; `authenticate()` at router level and `authorize()` at the mount; `super_admin` bypasses staff role checks. Self-scoped resources carry no `authorize` because the subject is `ctx.principal`. An impersonated session is a `user` session minted by staff: it carries the actor, rotates without extending, and refuses credential operations.",
      },
      {
        topic: "Database",
        records: ["0006", "0008", "0061"],
        text: "Schema in `packages/db/src/schema`; migrations are generated with `drizzle-kit generate` and committed, never pushed; the API never auto-migrates; seeds are idempotent. The API connects as the application role (`DATABASE_URL`) with table privileges and no DDL, and every tooling connection is the owner role (`DATABASE_URL_OWNER`, required with no fallback).",
      },
      {
        topic: "Append-only audit",
        records: ["0058", "0061"],
        text: "`audit_events` is append-only in the database as well as in the lint rule — a revoked grant and a `BEFORE UPDATE OR DELETE` trigger — so retention is a reviewed migration and never a job.",
      },
      {
        topic: "Per-population data",
        records: ["0045", "0053"],
        text: "Per-population data gets a table per population with a real foreign key rather than a discriminated table; `sessions` is the single exception and says why in place.",
      },
      {
        topic: "List endpoints at scale",
        records: ["0014", "0060"],
        text: "One list-query language, its codec in `@repo/contracts`. `offset` has a ceiling and `count` is an optional flag: with `count=false` a repository skips the aggregate and returns `total: null`. Every sortable and searched column carries a covering index declaration, trigram indexes for search and btree for sorts.",
      },
      {
        topic: "Infrastructure seams",
        records: ["0066"],
        text: "Mail goes through the `MailSender` port in `core/mail` and never through a client a service imports; `GET /metrics` lives in `core/metrics` beside `/health`, above every limiter, labelled by route pattern and behind a token; the reporter in `core/reporting` fires on 5xx only and is given the request id, route, status and principal — never the body; the four limiters share one store, Redis when configured and memory otherwise, failing closed. All four are inert in a default clone.",
      },
      {
        topic: "Logging",
        records: ["0005"],
        text: "pino through `ctx.logger`; a fields object first and a short static message second; no `console.*`.",
      },
      {
        topic: "Contracts",
        records: ["0023"],
        text: "`@repo/contracts` depends on `zod` alone; an enum is defined there once and consumed by both `pgEnum` and zod.",
      },
      {
        topic: "Tests",
        records: ["0021"],
        text: "Unit tests use fake repositories as plain objects; integration tests go through `createApp(buildContainer({ db: testDb }))` and supertest against the test database. Every new endpoint gets both, plus a Postman request.",
      },
      {
        topic: "Lint is the mechanical half",
        records: ["0002", "0062"],
        text: "`packages/config-eslint/api.js` already fails the build on classes, raw responses, `process.env` and layer-crossing imports. A rule a reviewer keeps repeating belongs there instead.",
      },
    ],
  },
  {
    slug: "frontend-and-platform",
    title: "Frontend and platform — the rules in force",
    loadWhen:
      "`apps/admin`, `apps/customer`, `packages/ui` and the seven platform packages",
    rules: [
      {
        topic: "Where the machinery lives",
        records: ["0051", "0062"],
        text: "The behavioural machinery is packages, not app code: `@repo/api-client` (client, session, CSRF, URL⇄query), `@repo/i18n`, `@repo/resource`, `@repo/grid`, `@repo/form`, `@repo/app-services` and `@repo/app-kit` (the provider stack, the auth and account layouts, the app loader, the top-level error boundary, the router defaults, the app i18n factory, and the SPA test harness behind its own `testing` entry). An app keeps what a door cannot bind with a value — its providers, router, route tree, dictionary, policy data, config and size budget.",
      },
      {
        topic: "Doors",
        records: ["0051", "0062"],
        text: "An app reaches a platform package only through its own `shared/` door; `no-restricted-imports` refuses the package path anywhere else. A door is the only path to those symbols — not one slice per package, since a slice may front several — so the door blocks are generated per slice from each app's `DOORS` table.",
      },
      {
        topic: "Design system",
        records: ["0047", "0054"],
        text: "shadcn/ui in `@repo/ui` on Tailwind v4, reached only through the `shared/ui` door. The design speaks through three surfaces — the token sheet, the hand-written compositions, and the grid's own styling; a need none of the three can meet is an owned edit carrying its comment, or a finding for the record, never a quiet restyle of a generated primitive.",
      },
      {
        topic: "Tokens",
        records: ["0054"],
        text: "Colour, radius, type and spacing come from tokens; a raw hex or an arbitrary `oklch()` in a component is the defect. The neutrals and the primary sit on one hue at low chroma, borders are solid rather than alpha in dark, and four tokens extend shadcn's set.",
      },
      {
        topic: "Generated versus written UI",
        records: ["0047"],
        text: "Primitives under `packages/ui/src/components/` and `src/hooks/` stay byte-identical to the CLI output and are prettier-exempt; an edit to one earns itself with a comment naming the rule that forced it. Hand-written compositions live in `src/compositions/` under the ordinary regime and are presentation-only: no contracts import, no routing, no forms, no session.",
      },
      {
        topic: "Architecture",
        records: ["0049", "0051", "0062"],
        text: "FSD layers `app → pages → widgets → features → entities → shared` with downward-only imports enforced by lint, and file-based routes. An entity may not import another entity — the feature layer is where two entities meet.",
      },
      {
        topic: "Session",
        records: ["0033", "0051", "0030", "0056"],
        text: "Credentials live in memory only — no token, CSRF token or principal in `localStorage`, `sessionStorage` or a client-set cookie; non-credential display state may be persisted. Refresh is single-flight, the CSRF token comes from the bootstrap endpoint, its cookie is named per population, and the client never reads `document.cookie`.",
      },
      {
        topic: "Server state",
        records: ["0043", "0044"],
        text: "TanStack Query owns all server state through per-entity key factories — never an inline key. Outcomes are declared in typed mutation `meta` and delivered by one global handler; queries are silent and render their own failure panel. List state lives in the URL in the API's own query language through the shared codec; a record URL carries only the record, and the way back travels as history state.",
      },
      {
        topic: "Resource configs",
        records: ["0035", "0063"],
        text: "One `ResourceConfig<TRow, TCreate, TUpdate>` per resource — serializable config plus named registries — drives both the grid and the config-driven forms over the contracts schemas; every field is disabled while a mutation is pending, and copy in a config is a translation key. Columns are keyed by the row and fields by either body; the claims no type can make are one call of `assertConfigMatchesContract`.",
      },
      {
        topic: "The grid",
        records: ["0037", "0038", "0039", "0041", "0042", "0052", "0054"],
        text: "A grid page is a height budget with one scroll container, a sticky header and a static pager, every wrapper down to the grid carrying `flex flex-col flex-1 min-h-0` and nothing on that path clipping. Capability flags say what a surface offers and `can(action, resource)` says who may use it, conjoined once per screen so the grid never learns a resource name. There is no filter row: a filterable column gets a header dialog that commits on Apply, hot filters are toolbar stances, and the applied-filters bar renders from the URL. Create and the Columns control sit in the page-header band. Bulk delete is a bounded client-side fan-out with per-item refusals.",
      },
      {
        topic: "What owns what",
        records: ["0041", "0043", "0044", "0054"],
        text: "The URL owns view state, preferences own ergonomics, history state owns the way back, and the table owns nothing durable. Preferences, theme, locale and row density are an account fact with `localStorage` as the cache in front, and the preference store never learns that a grid id is on the wire. Density is a mode rather than a scale, moving the row height, the cell padding and the in-row badge and nothing else.",
      },
      {
        topic: "The account area",
        records: ["0053"],
        text: "One `/account` route family with sections; the account menu is identity and exit only, the quick controls live in preferences, and the sidebar carries no account entry.",
      },
      {
        topic: "Copy",
        records: ["0046"],
        text: "Two localized catalogues: error codes in the `errors` namespace, typed complete over `ErrorCode`, and field rules as zod's own messages through the client-side error map. The API's `error.message` is never rendered. Every operator-facing string is a typed key — a literal in JSX fails lint. `@repo/ui` gains no i18n dependency; its strings arrive through the `UiStrings` context.",
      },
      {
        topic: "Brand seams",
        records: ["0064"],
        text: "The app identifier is configuration, not a literal: the API derives its cookie names and token audience from it, and each SPA derives every device-storage key as `${appId}.${segment}.${fact}` through parameters on the packages that store anything.",
      },
      {
        topic: "Testing",
        records: ["0036", "0052"],
        text: "Vitest, Testing Library and MSW with handlers derived from the contracts; no live-API tier, because a mock more permissive than the service certifies the opposite of production. Assertions go by accessible name in English, and the pseudo-locale suite proves no literal survived.",
      },
      {
        topic: "Build and budget",
        records: ["0002", "0062"],
        text: "Packages stay source-only and Vite consumes `src`; project references add a declarations-only build for type-checking, emitted where nothing resolves to it at runtime. Vendor groups are explicit chunks, sourcemaps are hidden, and each SPA's budget carries per-chunk ceilings beside its totals.",
      },
      {
        topic: "Invalidation",
        records: ["0043"],
        text: "A mutation invalidates its own entity's keys; the feature invalidates whatever else the interaction touched.",
      },
    ],
  },
  {
    slug: "process",
    title: "Process — the rules in force",
    loadWhen:
      "`/scope`, `/step`, `/steps`, `/ship`, `/new-adr`, `/bootstrap` and any review pass",
    rules: [
      {
        topic: "Deliverables",
        records: ["0025"],
        text: "Work is staged into numbered deliverables, one plan file each, steps written `D<n>.<step>`. One deliverable is in progress at a time, and it closes on an executable acceptance checklist.",
      },
      {
        topic: "The window",
        records: ["0025"],
        text: "An ADR may be amended in place only while the deliverable it belongs to is in progress; once that deliverable ships the record changes only by supersession. Which window is open, and which records are in force, is stated in one place — the ledger — and linked from everywhere else.",
      },
      {
        topic: "Acceptance at the head",
        records: ["0025"],
        text: "A record written `proposed` is accepted at the head of the step that builds it, so a step whose record is still `proposed` is gated and must not be started.",
      },
      {
        topic: "Supersession states the delta",
        records: ["0050"],
        text: "A superseding record states the delta and carries the parent's untouched sections by reference; whole restatement is permitted and never required. Where a supersession is a delta the parent still stands for everything the successor does not touch.",
      },
      {
        topic: "Altitude",
        records: ["0050"],
        text: "A record decides; it does not enumerate. Counts, rosters and anything a compiler could check belong in tests and lint rules rather than in prose.",
      },
      {
        topic: "Verification",
        records: ["0050"],
        text: "Machines are the gate; review is one bounded pass over the diff per step — no refutation rounds and no zero-finding requirement. Uncertain mechanics get a timeboxed spike in a worktree rather than a debate.",
      },
      {
        topic: "The gate",
        records: ["0026", "0052", "0057"],
        text: "The gate command is defined once, in `CLAUDE.md` §Commands, and referenced by name everywhere else. `pnpm check` is the cached inner loop; a task whose result depends on anything outside the repository is never cached and declares its `env`.",
      },
      {
        topic: "Forking",
        records: ["0065"],
        text: "A fork is a clone that keeps history, adds this repository as the `starter` remote and merges from it. A fork never edits an inherited record — it supersedes, because an edit turns the next merge into a conflict and erases which decision was deliberately dropped. `docs/adr/` and `.claude/` are carried into a fork; `docs/plan/` is this repository's journal and resets.",
      },
      {
        topic: "Upstreaming",
        records: ["0065"],
        text: "A generic feature travels back re-implemented as its own deliverable off `starter/main`, never as a cherry-pick: the fork's diff is the specification, not the patch. Generic has a test — no fork domain nouns, and no reference to the fork's own record numbers or plan steps.",
      },
      {
        topic: "Versioning",
        records: ["0065"],
        text: "`/ship` tags the shipping commit `starter-D<n>` and writes one changelog entry per shipped deliverable. Not per commit, and not semver.",
      },
      {
        topic: "Citations that survive a fork",
        records: ["0065"],
        text: "In `.claude/**` every record citation carries a topic gloss and never a bare range, and no step numbers or dates appear. Source-code comments keep their step references — they are the reasoning attached to the code that carries it.",
      },
      {
        topic: "The digests",
        records: ["0065"],
        text: "`docs/rules/<area>.md` states the rules currently in force, each line naming its record; the rule files and the skills load the digest for their area. The records remain the source of truth, and the digest is generated at ship rather than edited.",
      },
    ],
  },
];

const HEADER_NOTE =
  "<!-- Generated by `node scripts/rules-digest.mjs` — do not edit by hand. The records in `docs/adr/` are the source of truth; `/ship` regenerates this file. -->";

/** Reads every ADR, returning `{ id: { title, slug, status, successors, delta } }`. */
export async function readRecords(root = repoRoot) {
  const dir = path.join(root, "docs", "adr");
  const files = (await readdir(dir)).filter((name) =>
    /^\d{4}-.*\.md$/.test(name),
  );
  const records = {};
  for (const file of files) {
    const id = file.slice(0, 4);
    const body = await readFile(path.join(dir, file), "utf8");
    const heading = body.match(/^#\s*ADR-\d{4}:\s*(.+?)\s*$/m);
    const status = body.match(/^-\s*Status:\s*(.+?)\s*$/m);
    if (!heading || !status)
      throw new Error(`ADR ${id}: no title or status line`);
    const statusText = status[1];
    const superseded = /^superseded by/i.test(statusText);
    records[id] = {
      id,
      file,
      // The gloss is the record's own title, cut at whichever separator the
      // title uses for its subtitle — an em dash, a colon or a parenthesis.
      title: heading[1].split(/ — |: | \(/)[0].trim(),
      status: statusText,
      superseded,
      delta: superseded && /delta/i.test(statusText),
      successors: superseded ? successorsOf(statusText) : [],
    };
  }
  return records;
}

/**
 * The successors named by a `- Status: superseded by …` line.
 *
 * Only *linked* references count. A delta note routinely names other records
 * in prose — ADR-0050's names the parent whose reasoning it restores — and a
 * bare match would read that parent as a successor and print the supersession
 * backwards.
 */
export function successorsOf(statusText) {
  return [...statusText.matchAll(/\[ADR-(\d{4})\]\(/g)].map((m) => m[1]);
}

function glossFor(id, records) {
  const record = records[id];
  if (!record) throw new Error(`digest cites ADR-${id}, which does not exist`);
  if (record.superseded && !record.delta) {
    throw new Error(
      `digest cites ADR-${id}, which is wholly superseded by ADR-${record.successors.join(", ADR-")} — cite the successor`,
    );
  }
  const link = `[ADR-${id}](../adr/${record.file})`;
  // Lower-case the leading letter so the gloss reads inside a sentence — unless
  // the title opens on an acronym or a code identifier, where case is meaning.
  const gloss = /^[A-Z][a-z]/.test(record.title)
    ? record.title.charAt(0).toLowerCase() + record.title.slice(1)
    : record.title;
  if (record.superseded) {
    const carriers = record.successors
      .map((s) => `[ADR-${s}](../adr/${records[s].file})`)
      .join(" and ");
    return `${link} (${gloss}) as carried by ${carriers}`;
  }
  return `${link} (${gloss})`;
}

export function renderArea(area, records) {
  const lines = [
    HEADER_NOTE,
    "",
    `# ${area.title}`,
    "",
    `Loaded with ${area.loadWhen}. Each line names the record it comes from; open that record when the line is not enough. Which window is open and which records are in force is stated once, in [the ledger](../plan/README.md#the-window).`,
    "",
  ];
  for (const rule of area.rules) {
    // A record the corpus does not hold is not a rule this corpus is under. A
    // fork bootstrapped from nothing (`/bootstrap --empty`) has no records yet,
    // and its digests start empty rather than citing the starter's. A record
    // that exists but is out of force is a different matter and still throws.
    const cited = rule.records.filter((id) => records[id]);
    if (cited.length === 0) continue;
    const citation = cited.map((id) => glossFor(id, records)).join(", ");
    lines.push(`- **${rule.topic}** — ${rule.text} — ${citation}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function generate({ root = repoRoot, check = false } = {}) {
  const records = await readRecords(root);
  const { default: prettier } = await import("prettier");
  const results = [];
  for (const area of AREAS) {
    const target = path.join(root, "docs", "rules", `${area.slug}.md`);
    const options = await prettier.resolveConfig(target, {
      editorconfig: false,
    });
    const rendered = await prettier.format(renderArea(area, records), {
      ...options,
      filepath: target,
      // `endOfLine: "auto"` reads the existing file, which a generator has just
      // rewritten; LF keeps the output identical on every platform.
      endOfLine: "lf",
    });
    let previous = null;
    try {
      previous = await readFile(target, "utf8");
    } catch {
      previous = null;
    }
    const changed = previous !== rendered;
    if (!check && changed) await writeFile(target, rendered, "utf8");
    results.push({ slug: area.slug, target, changed });
  }
  return results;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const check = process.argv.includes("--check");
  const results = await generate({ check });
  const stale = results.filter((r) => r.changed);
  if (check && stale.length > 0) {
    console.error(
      `Out of date: ${stale.map((r) => r.slug).join(", ")}. Run node scripts/rules-digest.mjs.`,
    );
    process.exit(1);
  }
  console.log(
    check
      ? `docs/rules: up to date (${results.length} digests)`
      : `docs/rules: wrote ${stale.length} of ${results.length} digests`,
  );
}
