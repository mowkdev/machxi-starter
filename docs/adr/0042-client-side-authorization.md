# ADR-0042: Client-side authorization — `can(action, resource)` over the principal's roles

- Status: proposed
- Date: 2026-08-20

> One of the D4 (data grid v2) decision set, written ahead of the deliverable alongside [ADR-0037](0037-grid-viewport-layout.md)–[0041](0041-grid-preferences.md) (`docs/plan/0004-data-grid-v2.md`, `planned`). Unlike those five it claims no step of its own: it is the vocabulary the affordances D4 builds are gated with, so the plan's step 3 (selection, capabilities and the toolbar) and step 6 (the sweep over both resources) are where it lands, and the index cell says `D4 (not yet built)` rather than naming one. It becomes amendable in place while D4 is `in progress` in [`docs/plan/README.md`](../plan/README.md) ([ADR-0025](0025-deliverables.md) rule 2).

## Context

[ADR-0019](0019-authorization-guards.md) is entirely server-side, and deliberately so: `authenticate()` at router level, `authorize(...roles)` at the mount point, `super_admin` bypassing every staff role check on the one line in the middleware that says so, and — below all of that — the invariants no guard can express. ADR-0017's rank rule ("a target that outranks you is protected from you"), the refusal to disable or delete the last active `super_admin`, "nobody deletes themselves": those live in the services, because they are facts about *this row* and *this actor* rather than about a URL.

D3 built the admin panel on top of that and pre-guessed none of it. The decision is recorded where it was taken, in `apps/admin/src/features/staff-manage/use-staff-row-actions.ts`: `RowAction.isDisabled` exists and is left unused, because whether an account may be deleted depends on the actor's rank, on how many active super admins remain and on whether the target is the actor — the first two are state the app does not hold and the third would cover only one of the three refusals. Offering the action and rendering the server's answer is honest; greying out one case and silently mishandling the other two is not. That argument was right and this ADR does not overturn it.

D3.8 found the case it does not cover, and left it in `docs/plan/0003-admin-app.md` step 8's deferred list. `/admin/users` is mounted `authorize("admin", "manager")` — a manager may read the customer base — and the resource router narrows its five writing routes back to `authorize("admin")`. So a `manager` legitimately reaches `/users`, sees the grid they are entitled to see, and is refused by every row action and by the create button. Nothing leaks: the guard holds, the `403` arrives, and [ADR-0034](0034-server-state-and-notifications.md)'s message map renders it correctly. What is wrong is the affordance. The panel offers an operator six controls it knows in advance will all fail, and then explains each failure one click at a time.

**The load-bearing distinction, which is what this ADR is really about.** The API's authorization has two halves with different epistemics, and D3 treated them as one.

**Mount-level role guards are static, declarative and fully knowable to a client.** They are a table — resource × action → roles — written in `apps/api/src/routes/admin.router.ts` and in each resource router, and they depend on nothing whatsoever except which roles the principal holds. A client that holds the principal holds every input the guard reads. `authorize("admin", "manager")` on `/users` and `authorize("admin")` on its writes is not hidden state; it is a fact about the shape of the API that happens to be written in a file the browser cannot see.

**Service-level rules are dynamic.** They read the target row, the count of remaining super admins, the identity of the actor relative to the subject. A client asking "may this be deleted?" is asking a question whose answer depends on data it does not have and must not pretend to — and a client that guesses is worse than one that asks, because a wrong guess in either direction is silent.

So the rule this ADR records is a scoping of D3's, not a reversal: **the client may answer the static half, and must never attempt the dynamic half.** D3.7's note stays exactly as written; it is now the second half of a sentence whose first half is here.

## Decision

### `can(action, resource)` lives in `shared/auth`, over a policy table that is data

**A pure predicate over the principal's roles and a serializable policy table, in the FSD shared layer ([ADR-0032](0032-admin-app-architecture.md)).** `shared` is where it belongs by that ADR's own rule and not by convenience: `can` holds no domain knowledge beyond a data table naming the resources — it does not know what a staff member *is*, only that `staff` is a thing with actions and roles — and every layer above it may reach it, which matters because three different layers need the same answer (a widget's sidebar, a page's toolbar, a feature's row menu). Any lower home is impossible and any higher one would put the answer out of reach of something that needs it, which is the shape of argument ADR-0033 already used to move `context.tsx` into `shared/api`.

```
apps/admin/src/shared/auth/
  policy.ts        # RESOURCE_POLICY — the table, and the names it is keyed by
  can.ts           # can(principal, action, resource) — the pure predicate
  capabilities.ts  # allowedCapabilities() — the ADR-0038 conjunction, in one place
  context.ts       # useCan(), useAllowedCapabilities() — the bound hooks
  index.ts         # the slice's public API (ADR-0032)
```

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

That store's `roles` are the account's rather than the token's claims after D3.9's `useSetPrincipal`, and ADR-0033 §The session store explicitly handed *this* ADR the question of which of the two a client-side vocabulary reads. **The answer is: whatever the store holds, and the divergence is not worth a mechanism.** ADR-0017 revokes the subject's sessions inside the transaction that changes their role set, so a demoted operator's next request fails and the panel returns them to `/login`; the window in which the database and the claims disagree is bounded by one request, not by `JWT_ACCESS_TTL`. And in that window the client is not the thing that matters, because of the next rule.

**Non-staff answers `false` and is unreachable.** `apps/admin`'s client is pinned to `/api/v1/admin` (ADR-0033), so the store can only ever hold a staff principal; the population check is there to make the predicate total rather than to guard anything, and it means `can` never has to be generic over populations the way `authorize` is.

### It composes with ADR-0038's capabilities, and does not replace them

Two different questions, both answered before an affordance renders. **A capability says *this surface offers the action*; `can()` says *this operator's role may perform it*. An affordance renders only when both are true.** ADR-0038's own sentence — "these are UI capabilities, not authorization" — stays true exactly as written, and this ADR is the other half of it rather than a contradiction: `grid.canDelete` still means "this resource's grid offers deletion", and it is still not a claim about the operator. It is now conjoined with one.

The conjunction happens **once per screen, above both of ADR-0038's readers**, so that neither has to know about the other:

```ts
// apps/admin/src/shared/auth/capabilities.ts
export const allowedCapabilities = (
  capabilities: GridCapabilities | undefined,
  canFn: CanFn,
  resource: ResourceName,
): GridCapabilities | undefined => /* AND each write flag with canFn(action, resource) */;

// pages/users/index.tsx — one line, and everything downstream reads the narrowed block
const grid = useAllowedCapabilities(userResourceConfig.grid, "users");
```

The reason it is a narrowing of the block rather than an `&&` at each button: `shared/grid` must not learn a resource's name. AppGrid takes `capabilities` and renders Create and bulk Delete from it (ADR-0038); a grid that called `can` itself would need to be told which resource it is showing, which is precisely the domain knowledge ADR-0035 keeps out of `shared/grid` and ADR-0032 keeps out of `shared` at all. Narrowing above the grid leaves AppGrid ignorant and keeps ADR-0038's "one config block, two readers" true — the feature's `useStaffRowActions` reads the same narrowed block for its `edit` and `delete` entries, so the menu and the toolbar cannot disagree about what this operator sees.

### It is never a security control

**The API's guards remain the enforcement, and every call still renders the server's answer.** Nothing in this ADR is permitted to become the reason a request is not made — a `can()` that wrongly returns `true` costs a `403` an operator can read through ADR-0034's message map, which is exactly what D3 shipped and what still happens today for every dynamic refusal. The client hiding something is a courtesy, not a boundary.

Stated as a rule so it survives being read quickly: **removing `can` from `apps/admin` entirely must change nothing about which requests the API accepts.** If it ever would, the check has migrated into somewhere it does not belong, and the fix is in `apps/api`.

### What it may gate, and what it may not

**May:** sidebar navigation entries (`widgets/app-sidebar` filters its items by `can("read", resource)`, so a `manager` is not offered a Staff link into a page whose list query answers `403`); the toolbar's Create; row-menu entries.

**May not:** anything whose refusal depends on the target row or on global state. The delete entry on a staff row is offered to an `admin` and rendered enabled, and whether *that* staff member may be deleted is answered by the API — the rank rule, the last-super-admin invariant and the self-delete refusal are D3.7's paragraph, unamended. A `can()` that grew a `row` parameter would be this ADR crossing the line it was written to draw.

### The cost, stated rather than buried

**`RESOURCE_POLICY` is a second copy of the API's mount guards, in a different app, with nothing enforcing that the two agree.** `apps/admin` cannot import from `apps/api` — apps do not import apps — and the guards are not in `@repo/contracts`, which by [ADR-0023](0023-shared-contracts-package.md) holds schemas and types rather than the API's routing decisions. So the table will drift, and the honest question is what drift costs.

**It fails asymmetrically, which is the whole reason it is acceptable.** A client that *hides* an action the API would have allowed costs a feature, and it is visible: an operator who believes they should be able to create a user says so, and the table is one file. A client that *shows* an action the API refuses is exactly the D3.8 defect — the thing this table exists to remove. The failure mode this introduces is strictly less bad than the one it fixes, and it is the same shape as ADR-0038's note that a capability mistaken for a permission is harmless in the safe direction.

**The mitigation is a fixture test and a pointer.** A test in the ADR-0036 unit tier lists the mounts verbatim — transcribed from `admin.router.ts` and each resource router, with the file each line came from named beside it — and asserts `RESOURCE_POLICY` equals that fixture. That does not detect a change in `apps/api`, and claiming otherwise would be the mitigation lying: it converts a silent one-file edit into a deliberate two-file one, and it puts the transcription somewhere a reviewer of an `authorize` change can be pointed at. This is the same instrument, and the same honesty about its limits, that ADR-0033 §Consequences applies to the two header names duplicated out of `core/http/cookies.ts`: the copy cannot drift silently, and whoever supersedes ADR-0019 must find this ADR — this sentence is the pointer.

**The real fix is the API publishing its own answer**, and it is the first alternative below rather than a follow-up buried here.

### What this does not decide

- **Whether a route itself is role-gated.** A `manager` who types `/staff` still reaches the page and sees its list query fail. Hiding the nav entry is a control question and this ADR answers it; turning the route away in `beforeLoad` is a routing question — it needs a redirect target, a message that is not a toast on an empty screen, and an answer for the `redirect` search param — and it belongs to whichever step builds it, with ADR-0032 §Layout topology and guards to answer to.
- **Anything dynamic.** Per-row refusals stay server-answered, per D3.7 and §What it may not.
- **Any change to `apps/api`.** D4 remains a frontend deliverable ([ADR-0038](0038-grid-selection-and-capabilities.md) made the same commitment for bulk delete).
- **`apps/web`.** ADR-0032 scopes itself to `apps/admin` and so does this; the user segment has one role and no admin surface to gate.

## Consequences

- **The D3.8 defect closes**, and it closes for every future resource at the cost of one table row: a resource whose read guard is wider than its write guards declares that once, and its grid stops offering writes to the roles that only read.
- **A second place now encodes who may do what**, and D4 accepts that knowingly. The asymmetry argument above is why; the fixture test and this ADR's cross-reference from ADR-0019's eventual successor are the mitigations, and neither is a guarantee.
- **`shared/auth` is a new slice**, and it is the natural home for anything else that is a fact about the principal rather than about a resource — which is also the risk: it must not become the place service-level rules are re-implemented. §It is never a security control is the rule that keeps it small, and a `can` signature that grows a row argument is the review trigger.
- **The sidebar becomes principal-dependent**, so the shell renders differently for two operators. That is the intent, and it makes the widget's tests principal-parameterised rather than static.
- **An operator sees a smaller app than the one that exists**, with no indication that more is there. For a role-based product that is correct — a manager does not need to know the staff resource exists — but it does mean "I can't find X" support questions have a new possible answer, and the policy table is where it is looked up.
- **Tests (ADR-0036), three, none optional**: render a resource screen with a `manager` principal and assert the write affordances are *absent* (`queryByRole("button", { name: /create/i })` is null, and the row menu offers no destructive entry); render the same screen with an `admin` and assert they are present; and the fixture test above, pinning `RESOURCE_POLICY` against the transcribed mounts. The first two are the ones that would have caught D3.8, and they are cheap because the session store is a constructor parameter in the test harness rather than a module to mock.

## Alternatives considered

- **Do nothing — D3's posture, kept.** It is right about the dynamic half and this ADR keeps it there verbatim: an action whose refusal depends on the row is offered, attempted and explained by the server. What it cannot justify is the static half, because there the client is not guessing — it knows, before the click, that every write on this page will be refused for the same reason, and rendering six controls to explain that six times is not honesty, it is noise. The distinction is why this ADR is a scoping rather than a replacement.
- **Publish the policy from the API** — effective capabilities on `PrincipalResource`, or a `GET /admin/policy` endpoint returning the guard matrix. **This is the right end state**, and the reason it is not this decision is deliberate rather than dismissive. It changes an auth response shape governed by [ADR-0018](0018-authentication-sessions-and-tokens.md) and ADR-0023, both frozen with D1, so it is a superseding ADR and an API deliverable — not a field added to a type in a frontend step; and with exactly one client there is no second consumer to prove the shape against, which is the same premature-abstraction argument ADR-0033 used to decline extracting `@repo/api-client` before `web` exists. **`apps/web` (D5) is the trigger that should reopen it**: a second client transcribing the same guards a second time is the point at which the duplication stops being asymmetric and starts being a pattern.
- **Disable rather than hide.** `RowAction.isDisabled` is already there and it would be one line. Rejected because a disabled control an operator cannot explain is worse than an absent one — it says "this is possible but not now", which is true of a dynamic refusal and false of a role one; the operator waits, retries, or files a bug. Where the reason is the operator's own role, and therefore stable for as long as they are signed in, absence is the honest rendering. The related case — a page the operator cannot use at all — is not a control question and is left to routing above.
- **A permission string vocabulary** (`users:write`, `staff:delete`) instead of resource × action. ADR-0017 and ADR-0019 both reserve that path for the *server*, and adopting it on the client first would be more general than two resources justify while inventing a second naming system beside the one the routers already use — the client would speak `users:write` about a mount that says `authorize("admin")` on `PATCH /:id`, and the transcription the fixture test depends on would stop being a transcription. When the API grows permissions, this table's keys become the thing that is replaced, and a resource × action shape maps onto them more directly than a string vocabulary invented independently would.
