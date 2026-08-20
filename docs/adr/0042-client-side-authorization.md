# ADR-0042: Client-side authorization — `can(action, resource)` over the principal's roles

- Status: accepted
- Date: 2026-08-20

> One of the D4 (data grid v2) decision set, written ahead of the deliverable alongside [ADR-0037](0037-grid-viewport-layout.md)–[0041](0041-grid-preferences.md) (`docs/plan/0004-data-grid-v2.md`). It is the vocabulary the affordances D4 builds are gated with, so it lands at `D4.3` (selection, capabilities and the toolbar) beside [ADR-0038](0038-grid-selection-and-capabilities.md) — the two are halves of one question and shipping either alone rebuilds the defect that motivated both — and is exercised again at `D4.6`, the sweep over both resources. It becomes amendable in place while D4 is `in progress` in [`docs/plan/README.md`](../plan/README.md) ([ADR-0025](0025-deliverables.md) rule 2). **Accepted 2026-08-20**, at the head of `D4.3` and together with ADR-0038.

## Context

[ADR-0019](0019-authorization-guards.md) is entirely server-side, and deliberately so: `authenticate()` at router level, `authorize(...roles)` at the mount point, `super_admin` bypassing every staff role check on the one line in the middleware that says so, and — below all of that — the invariants no guard can express. ADR-0017's rank rule ("a target that outranks you is protected from you"), the refusal to disable or delete the last active `super_admin`, "nobody deletes themselves": those live in the services, because they are facts about *this row* and *this actor* rather than about a URL.

D3 built the admin panel on top of that and pre-guessed none of it. The decision is recorded where it was taken, in `apps/admin/src/features/staff-manage/use-staff-row-actions.ts`: `RowAction.isDisabled` exists and is left unused, because whether an account may be deleted depends on the actor's rank, on how many active super admins remain and on whether the target is the actor — the first two are state the app does not hold and the third would cover only one of the three refusals. Offering the action and rendering the server's answer is honest; greying out one case and silently mishandling the other two is not. That argument was right and this ADR does not overturn it.

D3.8 found the case it does not cover, and left it in `docs/plan/0003-admin-app.md` step 8's deferred list. `/admin/users` is mounted `authorize("admin", "manager")` — a manager may read the customer base — and the resource router narrows its five writing routes back to `authorize("admin")`. So a `manager` legitimately reaches `/users`, sees the grid they are entitled to see, and is refused by every row action and by the create button. Nothing leaks: the guard holds, the `403` arrives, and [ADR-0034](0034-server-state-and-notifications.md)'s message map renders it correctly. What is wrong is the affordance. The panel offers an operator six controls it knows in advance will all fail, and then explains each failure one click at a time.

**The load-bearing distinction, which is what this ADR is really about.** The API's authorization rules have different *epistemics*, and D3 treated them as one thing. The tempting split is by location — middleware versus service — and it is wrong, which is worth establishing before the right split is stated: `assertMaySetSuperAdmin` lives in `staff.service.ts`, but on the create path it is called `assertMaySetSuperAdmin(ctx, body.roles, [])` and reads nothing but the actor's roles and the request body. No target row, no global state. A rule is not dynamic because of the file it sits in. The split that matters is **what each rule's answer depends on**, and there are three cases, not two.

**Role-only — depends on `principal.roles` and nothing else.** The mount-level guards are the whole of this category today: a table of resource × action → roles, written in `apps/api/src/routes/admin.router.ts` and each resource router, `super_admin` bypassing on one line. A client that holds the principal holds every input those guards read. `authorize("admin", "manager")` on `/users` with its writes narrowed to `authorize("admin")` is not hidden state; it is a fact about the shape of the API that happens to be written in a file the browser cannot see. **This is the only category `can()` may answer.**

**Request-body-only — depends on the actor's roles *and* what the operator is about to send.** `assertMaySetSuperAdmin` is the live example: only a `super_admin` may put `super_admin` into a role set (ADR-0017, amended D1.9), so an `admin` filling in the create-staff form is offered a `super_admin` checkbox that the API will refuse. That is a genuine sibling of the D3.8 defect and it is **not** `can()`'s to fix: the answer is not "may this operator create staff" (they may) but "may this operator send *this value*", which is a property of a field's options rather than of an action. It is named here as an open item and scoped out below, deliberately, rather than smuggled into a predicate whose signature cannot express it.

**Row-or-global — depends on the target row, on how many active super admins remain, on whether the target is the actor.** ADR-0017's rank rule, the last-super-admin refusal, "nobody deletes themselves". A client asking "may *this* be deleted?" is asking a question whose inputs it does not have and must not pretend to, and a wrong guess is silent in either direction.

So the rule this ADR records is a scoping of D3's, not a reversal: **the client may answer the role-only category, and nothing else.** D3.7's note stays exactly as written; it is now the last of three cases rather than one of two.

## Decision

### `can(action, resource)` lives in `shared/auth`, over a policy table that is data

**A pure predicate over the principal's roles and a serializable policy table, in the FSD shared layer ([ADR-0032](0032-admin-app-architecture.md)).** `shared` is where it belongs by that ADR's own rule and not by convenience: `can` holds no domain knowledge beyond a data table naming the resources — it does not know what a staff member *is*, only that `staff` is a thing with actions and roles — and every layer above it may reach it, which matters because three different layers need the same answer (a widget's sidebar, a page's toolbar, a feature's row menu). Any lower home is impossible and any higher one would put the answer out of reach of something that needs it, which is the shape of argument ADR-0033 already used to move `context.tsx` into `shared/api`.

```
apps/admin/src/shared/auth/
  policy.ts        # RESOURCE_POLICY — the table, and the names it is keyed by
  can.ts           # can(principal, action, resource) — the pure predicate
  capabilities.ts  # allowedCapabilities() — the ADR-0038 conjunction, in one place
  context.ts       # useCan(), useAllowedCapabilities() — the bound hooks
  index.ts         # a barrel by choice, not by rule — see below
```

The `index.ts` is a convention here rather than an enforced boundary, and saying so avoids a claim the lint would not back. ADR-0032's public-API rule is expressed in `apps/admin/eslint.config.js` as a `file: { path: "**/index.{ts,tsx}" }` selector on the `to` clause — and every `allow` list reaches `shared` through `anyFileOf("shared")` instead, deliberately: the config's own comment says `shared` is exempt because its slices are the app's toolbox, directories of small modules, where an index per slice would be ceremony with no boundary to defend. Existing shared slices are already imported deeply. So nothing refuses `@/shared/auth/policy`, and the barrel exists only so that `RESOURCE_POLICY` has one obvious door and a reviewer can find every consumer by grepping one path.

```ts
// apps/admin/src/shared/auth/policy.ts
export type ResourceName = "staff" | "users";
export type ResourceAction =
  | "read" | "create" | "update" | "delete" | "setPassword" | "revokeSessions";

export type ResourcePolicy = Readonly<
  Record<ResourceName, Readonly<Partial<Record<ResourceAction, readonly StaffRole[]>>>>
>;

export const RESOURCE_POLICY = {
  // apps/api/src/routes/admin.router.ts — authorize("admin") at the mount, uniformly
  staff: {
    read: ["admin"], create: ["admin"], update: ["admin"],
    delete: ["admin"], setPassword: ["admin"], revokeSessions: ["admin"],
  },
  // mounted authorize("admin", "manager"); users.routes.ts narrows the five writes
  users: {
    read: ["admin", "manager"], create: ["admin"], update: ["admin"],
    delete: ["admin"], setPassword: ["admin"], revokeSessions: ["admin"],
  },
} as const satisfies ResourcePolicy;
```

**The table is data, not predicates**, for the reason [ADR-0035](0035-config-driven-resource-ui.md) keeps functions out of config and [ADR-0038](0038-grid-selection-and-capabilities.md) kept them out of the capability block: a table can be diffed against the routers it mirrors, snapshotted in a test, logged to see what a screen will offer, and read in full by a reviewer in one screenful. A `canDeleteStaff = (p) => …` per rule is a vocabulary with no bound and no fixture.

**The action names are the endpoints', not a new vocabulary.** `setPassword` and `revokeSessions` are the sub-resources [ADR-0027](0027-credential-self-service-and-reset.md) and the routers already call by those names; `read` / `create` / `update` / `delete` are the controller functions. Inventing names here would create a second naming system beside the one the routers use, which is the whole objection to permission strings below.

**Deny by default, exactly as ADR-0019 §Rules states it**: an action absent from a resource's block is allowed to `super_admin` alone. That is why the record is `Partial` — absence is a decision the type permits and the predicate answers, not an oversight it papers over.

**A resource with no role gate is not in the table.** `/admin/profile` mounts with no `authorize` at all — every staff role may read its own account and change its own password (ADR-0019 §3, ADR-0027) — so there is nothing for `can` to answer about it, and an entry claiming otherwise would be the config-declares-what-exists rule broken in the direction that costs an operator their own profile page.

```ts
// apps/admin/src/shared/auth/can.ts
export const can = (
  principal: PrincipalResource | null,
  action: ResourceAction,
  resource: ResourceName,
): boolean => {
  if (principal === null || principal.kind !== "staff") return false;
  if (principal.roles.includes("super_admin")) return true;   // ADR-0019, the one line
  const allowed = RESOURCE_POLICY[resource][action] ?? [];
  return principal.roles.some((role) => allowed.includes(role));
};

// apps/admin/src/shared/auth/context.ts
export const useCan = () => {
  const { principal } = useSession();                          // ADR-0033
  return useCallback(
    (action: ResourceAction, resource: ResourceName) => can(principal, action, resource),
    [principal],
  );
};
```

**The principal comes first and the hook binds it**, which is [ADR-0010](0010-request-context.md)'s convention carried across the wire — the API's services take `ctx` first so the same function is callable from anywhere, and the same split is what makes `can` unit-testable against a fabricated principal with no React at all ([ADR-0036](0036-admin-testing-strategy.md)), while call sites read `can("create", "users")`. It is the hook/function split ADR-0034 already draws for API calls, applied to a predicate.

**It reads the principal from the session store, through `useSession`** ([ADR-0033](0033-browser-api-client-and-session.md)) — never `document.cookie`, never storage, never a decoded access token. `useSession` deliberately exposes `{ principal, isAuthenticated }` and not the tokens, and this ADR needs nothing more: the roles are on the principal.

That store's `roles` are the account's rather than the token's claims after D3.9's `useSetPrincipal`, and ADR-0033 §The session store explicitly handed *this* ADR the question of which of the two a client-side vocabulary reads. **The answer is: whatever the store holds, and the divergence is not worth a mechanism — but the reason is narrower than it first looks, so it is stated precisely.**

For role changes made **through the API**, the window is one request. ADR-0017 revokes the subject's sessions inside the same transaction that changes their role set, and revocation is honoured per request, so a demoted operator's next call fails and the panel returns them to `/login` — the database and the claims disagree for one round trip, not for `JWT_ACCESS_TTL`.

For role changes made **out of band**, there is no window at all, only an unbounded gap. `packages/db/seeds/seeders/001-super-admin.ts` grants `super_admin` with an `insert … onConflictDoNothing` and revokes nothing — its own comment says repairing an account that lost the role is exactly what it is for — so any re-run of `pnpm db:setup`, and any grant applied by direct SQL, leaves the database's roles a superset of a live session's claims for as long as that session lives. The route by which that reaches the store is D3.9's: `PATCH /admin/profile` returns the account's roles read fresh, `useSetPrincipal` writes them in, and `can()` starts answering from a set the operator's token does not carry. **The consequence is a stale `true`** — an affordance offered and then refused — which is the shown-but-refused direction this table exists to remove, arriving by a different door. It is accepted rather than mechanised because the API still refuses, the operator still gets a message, and the alternative is per-request principal freshness, which is a frozen-ADR supersession already on the Planned list. It is recorded as a residual below rather than left for someone to rediscover.

**Non-staff answers `false` and is unreachable.** `apps/admin`'s client is pinned to `/api/v1/admin` (ADR-0033), so the store can only ever hold a staff principal; the population check is there to make the predicate total rather than to guard anything, and it means `can` never has to be generic over populations the way `authorize` is.

**A null principal also answers `false`, and that `false` means "not yet known".** The predicate is total, so it must answer something for the state ADR-0033's boot sequence passes through — and for the one `app-sidebar` already documents, where the store holds an access token but no principal. Conflating "no principal yet" with "denied" is safe for *rendering* (an affordance that appears a tick late is a flicker) and unsafe for anything irreversible, so the rule is: **no navigation, redirect or one-shot decision may be taken on a `can()` that was evaluated before the session resolved.** The shell's loading gate already holds every protected screen until `bootstrapSession` settles, which is why this is a rule to preserve rather than a mechanism to build; a consumer that reads `can()` outside that gate has to check `isAuthenticated()` itself, and the honest reading of a `false` there is "ask again".

### It composes with ADR-0038's capabilities, and does not replace them

Two different questions, both answered before an affordance renders. **A capability says *this surface offers the action*; `can()` says *this operator's role may perform it*. A discretionary affordance renders only when both are true** — the containment ones render on the capability alone, for the reason two sections down. ADR-0038's own sentence — "these are UI capabilities, not authorization" — stays true exactly as written, and this ADR is the other half of it rather than a contradiction: `grid.canDelete` still means "this resource's grid offers deletion", and it is still not a claim about the operator. It is now conjoined with one.

The conjunction happens **once per screen, above both of ADR-0038's readers**, so that neither has to know about the other:

```ts
// apps/admin/src/shared/auth/capabilities.ts
export const allowedCapabilities = (
  capabilities: GridCapabilities | undefined,
  canFn: CanFn,
  resource: ResourceName,
): GridCapabilities | undefined =>
  /* ANDs canCreate / canDelete / canBulkDelete with canFn(action, resource).
     canEdit is deliberately NOT narrowed — see §Containment controls. */

// pages/users/index.tsx — one line, and everything downstream reads the narrowed block
const grid = useAllowedCapabilities(userResourceConfig.grid, "users");
```

The reason it is a narrowing of the block rather than an `&&` at each button: `shared/grid` must not learn a resource's name. AppGrid takes `capabilities` and renders Create and bulk Delete from it (ADR-0038); a grid that called `can` itself would need to be told which resource it is showing, which is precisely the domain knowledge ADR-0035 keeps out of `shared/grid` and ADR-0032 keeps out of `shared` at all. Narrowing above the grid leaves AppGrid ignorant and keeps ADR-0038's "one config block, two readers" true — the feature's `useStaffRowActions` reads the same narrowed block, so the menu's Delete and the toolbar's bulk Delete cannot disagree about what this operator sees, and its `edit`, `reset-password` and `revoke-sessions` entries read flags the narrowing left alone. It also puts the containment carve-out in exactly one function instead of at every call site, which is the difference between a rule and a habit.

### It is never a security control

**The API's guards remain the enforcement, and every call still renders the server's answer.** Nothing in this ADR is permitted to become the reason a request is not made — a `can()` that wrongly returns `true` costs a `403` an operator can read through ADR-0034's message map, which is exactly what D3 shipped and what still happens today for every row-or-global refusal. The client hiding something is a courtesy, not a boundary.

Stated as a rule so it survives being read quickly: **removing *or tampering with* `can` must change nothing about which requests the API accepts.** The stronger verb is the accurate one: the table, the predicate and the principal all live in memory an operator's devtools can edit, so "what happens if this is deleted" understates it — the real question is what happens when it returns `true` for everything, and the answer must be "the same `403`s, one per attempt".

Three migrations of enforcement into the client are therefore forbidden by name, because each is a plausible next commit rather than an imaginary one. **`can()` gates rendering, and only rendering.**

- **Never a query's `enabled`.** Skipping the list query for an operator `can()` thinks may not read would replace the `403` this ADR promises with an empty grid and no explanation — a silent failure manufactured by the client, which is worse than the misleading affordance the ADR was written to remove.
- **Never a mutation's `mutationFn`.** A hook that refuses locally invents an error the ADR-0034 message map has no code for, and hides the one case where the client is wrong and the server would have said yes.
- **Never a router `beforeLoad`.** Covered again under §What this does not decide, because it is the one that looks most like a feature.

### Containment controls are never hidden by `can` alone

**Three of the six actions in the table are incident-containment controls, and hiding one of those is worse than showing it.** `revokeSessions` ends a compromised session, `setPassword` takes a stolen credential away, and an `update` that sets `status: "disabled"` stops the account entirely. An operator reaching for one of those is reaching for it *during* something. A hidden control is silent — no message, no code, nothing to escalate with — where a visible one that answers `403` tells them the control exists and that they need somebody who may use it. **So `can()` never removes those affordances; they render, and the server answers.**

`update` is the awkward one and is worth being exact about rather than rounding off. As "edit this person's name" it is discretionary; as "set their status to `disabled`" it is the containment control, and today the only route to the second is the same edit form. **So `canEdit` is not narrowed either** — not because editing a name is urgent, but because the disable path runs through it, and a rule that hid the form would hide the containment control by accident. The day disabling gets an affordance of its own is the day `canEdit` can be reconsidered, and this sentence is the note to reconsider it from.

That leaves `create` and `delete` as the flags `can()` actually hides. Deletion is deliberately on this side: it is destructive rather than containing, and containment has two better instruments that this rule keeps permanently visible, so an operator who cannot delete has lost nothing they needed in a hurry.

### What it may gate, and what it may not

**May:** navigation entries; the toolbar's Create; the row menu's and toolbar's delete entries.

Navigation needs one shape change to be safe, because the naive reading of "filter the items by `can`" is a bug. `NAVIGATION` in `widgets/app-sidebar` has four entries and only two of them name a resource — `/` is the dashboard and `/profile` is the resource this ADR deliberately keeps *out* of the table — so filtering on `can("read", item.resource)` would hide Dashboard and Profile from everybody but a `super_admin`, courtesy of deny-by-default doing exactly what it was asked. The item type therefore carries the join explicitly, and absence means "not gated":

```ts
const NAVIGATION = [
  { to: "/",        label: "Dashboard", icon: LayoutDashboardIcon },
  { to: "/staff",   label: "Staff",     icon: ShieldIcon,  resource: "staff" },
  { to: "/users",   label: "Users",     icon: UsersIcon,   resource: "users" },
  { to: "/profile", label: "Profile",   icon: UserIcon },
] as const satisfies readonly NavItem[];   // { to; label; icon; resource?: ResourceName }
```

**An item with no `resource` always renders.** That is the rule the policy table already states from the other end, where `/profile` is absent because no `authorize` guards it: a screen no role gates has no question for `can()` to answer, and a `false` about it is the predicate answering a question it was not asked.

**May not:** anything whose answer depends on **anything other than `principal.roles`**. That is the test, replacing the narrower "target row or global state" — `assertMaySetSuperAdmin` on the create path reads no row and no global state and is still outside, because it reads the request body. The delete entry on a staff row is offered to an `admin` and rendered enabled, and whether *that* staff member may be deleted is the API's answer: the rank rule, the last-super-admin invariant and the self-delete refusal are D3.7's paragraph, unamended. A `can()` that grew a `row` parameter — or a `body` one — would be this ADR crossing the line it was written to draw.

**The request-body category is an open item, not a solved one.** An `admin` on the create-staff form is still offered a `super_admin` checkbox the API will refuse with a `403`, which is the D3.8 defect one level down, at a field instead of a button. The shape of the answer is visibly not `can`'s: it is a field's `options` being narrowed by the actor's roles, which lands in ADR-0035's config-and-registry machinery, and deciding it inside this ADR would mean either a second signature for `can` or an options predicate in a config that is required to be data. It is named here so that the next person to see the checkbox finds a decision that says "known, and not this one" rather than silence.

### The cost, stated rather than buried

**`RESOURCE_POLICY` is a second copy of the API's mount guards, in a different app, with nothing enforcing that the two agree.** `apps/admin` cannot import from `apps/api` — apps do not import apps — and the guards are not in `@repo/contracts`, which by [ADR-0023](0023-shared-contracts-package.md) holds schemas and types rather than the API's routing decisions. So the table will drift, and the honest question is what drift costs.

**It fails asymmetrically — for discretionary affordances, and only for those.** This is the sentence the whole decision to accept a duplicated policy table rests on, so it is bounded rather than asserted. For `create` and `delete`, a client that *hides* something the API would have allowed costs a feature, and the cost is visible: an operator who believes they should be able to create a user says so, the table is one file, and nothing was happening on a clock. A client that *shows* an action the API refuses is the D3.8 defect this exists to remove. In that direction the failure this introduces is strictly less bad than the one it fixes, which is the same shape as ADR-0038's note that a capability mistaken for a permission is harmless in the safe direction.

**For containment controls the asymmetry inverts, and that is why §Containment controls exists.** A hidden `revokeSessions` during an incident is a silent absence with no error and nothing to escalate; the `403` it replaces is at worst a wasted click and at best the sentence that tells an operator to go and find an admin. Those three are not hidden by `can` alone, so the acceptable-asymmetry argument above is never asked to cover them — the table stays complete because completeness is what makes the fixture test a transcription, and the *gating* rule is narrower than the table.

**The wrong-`true` direction has one cost worth naming beyond the single `403`.** Under ADR-0038's bulk-delete fan-out, an offered-but-refused action is not one refusal but N: a selection of forty rows spends forty requests against the global `300 / 15 min / IP` budget ([ADR-0020](0020-security-baseline.md)), and an operator can rate-limit themselves out of the panel by exercising a control they were never allowed to use. The table removing that affordance is the fix; the fan-out's per-item summary toast (ADR-0038) is what makes the failure legible when the table is stale.

**The mitigation is a fixture test and a pointer.** A test in the ADR-0036 unit tier lists the mounts verbatim and asserts `RESOURCE_POLICY` equals that fixture. That does not detect a change in `apps/api`, and claiming otherwise would be the mitigation lying: it converts a silent one-file edit into a deliberate two-file one, and it puts the transcription somewhere a reviewer of an `authorize` change can be pointed at. This is the same instrument, and the same honesty about its limits, that ADR-0033 §Consequences applies to the two header names duplicated out of `core/http/cookies.ts`: the copy cannot drift silently, and whoever supersedes ADR-0019 must find this ADR — this sentence is the pointer.

**The fixture is transcribed from every `authorize(` call site — `admin.router.ts` and each resource router — and from no prose, including this ADR's.** That is a rule rather than a preference, because the prose is demonstrably the unreliable copy: `admin.router.ts`'s own comment said the users router narrows "four" writing routes and ADR-0019's D1.9 amendment says "three", where `users.routes.ts` in fact narrows five. Comments drift and ADR-0019 is frozen, so its miscount cannot be corrected at all — which is the strongest possible argument for transcribing the calls. A `authorize(` grep with no match in the fixture is the review question this arrangement is built to provoke.

**The table ships in the bundle, and that is examined rather than assumed.** `VITE_*` inlining aside, everything in `apps/admin/src` is compile-time public (ADR-0033 §Configuration): anyone who can load `/login` can read `RESOURCE_POLICY`, unauthenticated. That is acceptable — role names and resource names are already in `@repo/contracts` and the SPA ships its own route tree — but it deserves the sentence because ADR-0019 deliberately answers `401` rather than `404` to keep the API from revealing which paths exist, and a client that enumerates the admin surface for anonymous readers is worth having thought about rather than having overlooked. The rule it leaves behind: **no entry in this table may encode anything whose existence is itself secret.** A resource that must not be known to exist does not get a policy row; it gets a server-published answer (§Alternatives) or nothing.

**The real fix is the API publishing its own answer**, and it is the first alternative below rather than a follow-up buried here.

### What this does not decide

- **Whether a route itself is role-gated.** A `manager` who types `/staff` still reaches the page and sees its list query fail. Hiding the nav entry is a control question and this ADR answers it; turning the route away is a routing question — it needs a redirect target, a message that is not a toast on an empty screen, and an answer for the `redirect` search param — and it belongs to whichever step builds it, with ADR-0032 §Layout topology and guards to answer to. **One constraint is placed on it now, because deferring the decision must not defer the rule: whatever builds it gates on the server's answer — a `403` from the screen's own query — and never on `can()`.** A `beforeLoad` keyed on `can()` would make the client the thing that decides what is reachable, which removes the escape hatch this ADR relies on twice: the `403` that corrects a stale `true`, and the visible refusal that §Containment controls insists on. It would also turn a null-principal `false` — "not yet known" — into a redirect, which §`can(action, resource)` lives in `shared/auth` forbids by name.
- **Anything outside role-only.** Row-or-global refusals stay server-answered, per D3.7 and §What it may not; the request-body category is named there as an open item and is nobody's yet.
- **Any change to `apps/api`.** D4 remains a frontend deliverable ([ADR-0038](0038-grid-selection-and-capabilities.md) made the same commitment for bulk delete).
- **`apps/web`.** ADR-0032 scopes itself to `apps/admin` and so does this; the user segment has one role and no admin surface to gate.

## Consequences

- **The D3.8 defect closes for the discretionary half of itself.** A `manager` on `/users` stops being offered Create and Delete, and every future resource whose read guard is wider than its write guards gets the same for one table row. The manager still sees Edit, Reset password and Sign out everywhere, and still gets a `403` from each — deliberately, per §Containment controls. That is a smaller fix than the deferral's wording implies, and it is the right size: the misleading affordances that go are the ones whose absence costs nothing, and the ones that stay are the ones whose absence could cost an incident.
- **A second place now encodes who may do what**, and D4 accepts that knowingly. The asymmetry argument above is why; the fixture test and this ADR's cross-reference from ADR-0019's eventual successor are the mitigations, and neither is a guarantee.
- **`shared/auth` is a new slice**, and it is the natural home for anything else that is a fact about the principal rather than about a resource — which is also the risk: it must not become the place service-level rules are re-implemented. §It is never a security control is the rule that keeps it small, and a `can` signature that grows a row argument is the review trigger.
- **The sidebar becomes principal-dependent**, so the shell renders differently for two operators. That is the intent, and it makes the widget's tests principal-parameterised rather than static.
- **An operator sees a smaller app than the one that exists**, with no indication that more is there. For a role-based product that is correct — a manager does not need to know the staff resource exists — but it does mean "I can't find X" support questions have a new possible answer, and the policy table is where it is looked up.
- **Out-of-band role writes are a residual, and they are the one path to a stale `true`.** The super-admin seeder grants without revoking, and direct SQL does whatever it is told; either leaves a live session's claims behind the account's roles indefinitely, and D3.9's `useSetPrincipal` is the door through which the fresher set reaches the store. `can()` then offers an affordance the token cannot buy, and the API's `403` is what corrects it. Nothing here mitigates that beyond the enforcement staying where it is — per-request principal freshness is the real answer and is already on the Planned list as a supersession of ADR-0018.
- **Tests (ADR-0036), three, none optional**: render a resource screen with a `manager` principal and assert the discretionary affordances are *absent* while the containment ones are *present* — no Create button, no Delete entry, and Reset password and Sign out everywhere still in the menu, which is the assertion that stops a later "tidy-up" from hiding them; render the same screen with an `admin` and assert Create and Delete are back; and the fixture test above, pinning `RESOURCE_POLICY` against the transcribed `authorize(` calls. The first two are the ones that would have caught D3.8, and they are cheap because the session store is a constructor parameter in the test harness rather than a module to mock.

## Alternatives considered

- **Do nothing — D3's posture, kept where it was right.** It is right about the row-or-global category and this ADR keeps it verbatim: an action whose refusal depends on the row is offered, attempted and explained by the server. What it cannot justify is the role-only category, because there the client is not guessing — it knows, before the click, that a given write on this page will be refused for one unchanging reason. It is also, on the evidence of the containment carve-out, more nearly right than a wholesale fix would have been: half of what D3.8 complained about should keep rendering. The three categories are why this ADR is a scoping rather than a replacement.
- **Publish the policy from the API** — effective capabilities on `PrincipalResource`, or a `GET /admin/policy` endpoint returning the guard matrix. **This is the right end state**, and the reason it is not this decision is deliberate rather than dismissive. It changes an auth response shape governed by [ADR-0018](0018-authentication-sessions-and-tokens.md) and ADR-0023, both frozen with D1, so it is a superseding ADR and an API deliverable — not a field added to a type in a frontend step; and with exactly one client there is no second consumer to prove the shape against, which is the same premature-abstraction argument ADR-0033 used to decline extracting `@repo/api-client` before `web` exists. **`apps/web` (D5) is the trigger that should reopen it**: a second client transcribing the same guards a second time is the point at which the duplication stops being asymmetric and starts being a pattern.
- **Disable rather than hide.** `RowAction.isDisabled` is already there and it would be one line. Rejected because a disabled control an operator cannot explain is worse than an absent one — it says "this is possible but not now", which is true of a row-or-global refusal and false of a role one; the operator waits, retries, or files a bug. Where the reason is the operator's own role, and therefore stable for as long as they are signed in, absence is the honest rendering. The containment controls are not a counter-example to this: they are not disabled either, they are fully live and the server answers them. The related case — a page the operator cannot use at all — is not a control question and is left to routing above.
- **A permission string vocabulary** (`users:write`, `staff:delete`) instead of resource × action. ADR-0017 and ADR-0019 both reserve that path for the *server*, and adopting it on the client first would be more general than two resources justify while inventing a second naming system beside the one the routers already use — the client would speak `users:write` about a mount that says `authorize("admin")` on `PATCH /:id`, and the transcription the fixture test depends on would stop being a transcription. When the API grows permissions, this table's keys become the thing that is replaced, and a resource × action shape maps onto them more directly than a string vocabulary invented independently would.
