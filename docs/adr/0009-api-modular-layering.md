# ADR-0009: Modular API — route → controller → service → repository (functional style)

- Status: accepted
- Date: 2026-08-17

## Context

The API must grow to many features (identity, i18n, content, billing, …) with several teams touching it. We need a layout where a feature is found in one place, layers have single responsibilities, business logic is testable without HTTP or a database, and wiring is explicit rather than global.

The codebase is written in a **functional style**: modules export plain functions and factory functions returning plain objects; no classes, no `this`, no decorators, no DI container. Dependencies are passed in explicitly (closures / parameters).

## Decision

### Feature modules, layered inside

Code is organised **by feature module first, by layer second**. Cross-cutting infrastructure lives in `core/`.

```
apps/api/src/
├── main.ts
├── app.ts                       # createApp(container)
├── server.ts
├── core/
│   ├── config/                  # ADR-0004
│   ├── context/                 # ADR-0010
│   ├── errors/                  # ADR-0013
│   ├── http/                    # envelope helpers, pagination parsing (ADR-0012, ADR-0014)
│   ├── middleware/              # ADR-0011
│   ├── auth/                    # policy helpers only, see the step-8 amendment (ADR-0019)
│   ├── db/                      # thin re-export of @repo/db + DbExecutor type
│   └── container.ts             # composition root
├── modules/
│   ├── health/                  # ADR-0016
│   ├── auth/                    # one module, instantiated per population (step 8)
│   ├── staff/                   # staff CRUD (admin segment)
│   └── users/                   # users CRUD (admin segment) + self endpoints (user segment)
└── routes/
    ├── index.ts                 # mounts /health, /api/v1
    ├── public.router.ts         # /api/v1/public/*
    ├── user.router.ts           # /api/v1/user/*     (requires user principal)
    └── admin.router.ts          # /api/v1/admin/*    (requires staff principal)
```

**Amended 2026-08-18 (step 8).** Two corrections to the tree above, both
forced by decisions in other ADRs:

- **`modules/auth/`, not `staff-auth/` + `user-auth/`.** ADR-0017 §Principal
  abstraction requires one `createAuthService` called once per population
  behind a `PrincipalAdapter`; two modules would be two copies of rotation,
  reuse detection and revocation.
- **`core/auth/` holds policy helpers only** (`requirePrincipal`,
  `requirePopulation`, and later `assertOwnerOrRole`). The token service lives
  in `modules/auth/auth.tokens.ts` and password hashing in `@repo/crypto`
  (ADR-0018), because both are auth-module concerns rather than framework
  ones. `authenticate` also lives in the module: it depends on the token
  service _and_ the sessions repository, and `core` importing a module would
  invert the direction this ADR exists to fix. `authorize` does stay in
  `core/middleware` — it reads nothing but `ctx.principal` and has no
  dependencies at all.

Each module has a fixed internal shape:

```
modules/users/
├── users.routes.ts          # createUsersRouter(controller): binds paths → validation → handlers
├── users.controller.ts      # createUsersController(service): HTTP adapters (req/res → service → envelope)
├── users.service.ts         # createUsersService(deps): business logic; no req/res, no SQL
├── users.repository.ts      # createUsersRepository(db): all SQL for the aggregate via Drizzle
├── users.schemas.ts         # zod schemas for params/query/body + inferred DTO types
├── users.mapper.ts          # toUserResource(row): DB row -> API resource (pure)
├── users.types.ts           # module-local types (optional)
└── __tests__/
```

### Layer responsibilities

| Layer          | Knows about                                                   | Must not                                                           |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| **routes**     | Express Router, middleware, controller handlers               | contain logic                                                      |
| **controller** | `req`, `res`, request context, zod-validated DTOs, service    | touch DB, throw non-`AppError` on purpose, format ad hoc responses |
| **service**    | domain rules, repositories, other services, context principal | import Express types, build HTTP responses                         |
| **repository** | Drizzle, schema, `DbExecutor`                                 | contain business rules, decide HTTP status                         |

Services throw `AppError`s (ADR-0013); controllers never catch them — the error middleware maps them to responses.

### Shape of each layer

Every layer is a **factory function** that takes its dependencies and returns a frozen object of functions. Types are derived from the factory with `ReturnType`, so there is one source of truth and no interface/impl duplication.

```ts
// users.repository.ts
export const createUsersRepository = (db: Db) => ({
  findById: (id: string, tx: DbExecutor = db) => tx.query.users.findFirst({ where: eq(users.id, id) }),
  findByEmail: (email: string, tx: DbExecutor = db) => …,
  insert: (data: NewUser, tx: DbExecutor = db) => …,
  list: (query: ListQuery, tx: DbExecutor = db): Promise<Page<UserRow>> => …,
} as const);
export type UsersRepository = ReturnType<typeof createUsersRepository>;

// users.service.ts
type Deps = { usersRepo: UsersRepository; hasher: PasswordHasher; db: Db };
export const createUsersService = ({ usersRepo, hasher, db }: Deps) => ({
  getById: async (ctx: RequestContext, id: string) => {
    const row = await usersRepo.findById(id);
    if (!row) throw notFound('User not found');
    return toUserResource(row);
  },
  create: (ctx: RequestContext, dto: CreateUserBody) =>
    db.transaction(async (tx) => { /* … usersRepo.insert(data, tx) … */ }),
  listForAdmin: async (ctx: RequestContext, q: ListQuery) => mapPage(await usersRepo.list(q), toUserResource),
} as const);
export type UsersService = ReturnType<typeof createUsersService>;

// users.controller.ts
export const createUsersController = (svc: UsersService) => ({
  getById: async (req: ValidatedRequest<typeof getUserSchema>, res: Response) =>
    respond.ok(res, await svc.getById(req.ctx, req.valid.params.id)),
  create: async (req, res) => respond.created(res, await svc.create(req.ctx, req.valid.body)),
  list:   async (req, res) => respond.list(res, await svc.listForAdmin(req.ctx, req.valid.query)),
} as const);
export type UsersController = ReturnType<typeof createUsersController>;

// users.routes.ts
export const createUsersRouter = (c: UsersController) => {
  const r = Router();
  r.get('/',    validate(listUsersSchema), c.list);
  r.post('/',   validate(createUserSchema), c.create);
  r.get('/:id', validate(getUserSchema), c.getById);
  return r;
};
```

Pure helpers (mappers, policies, list-query builders, token encoding) are plain exported functions with no dependencies — importable directly, no factory needed.

### Wiring — explicit composition root, no DI container

`core/container.ts` builds everything once, in dependency order, by calling the factories:

```ts
export const buildContainer = ({
  config,
  db,
  logger,
}: {
  config: AppConfig;
  db: Db;
  logger: Logger;
}) => {
  const hasher = createArgon2Hasher(config.auth.argon2);
  const tokens = createTokenService(config.auth);

  const staffRepo = createStaffRepository(db);
  const usersRepo = createUsersRepository(db);
  const sessionsRepo = createSessionsRepository(db);

  const staffAuth = createAuthService({
    population: "staff",
    principals: staffPrincipalAdapter(staffRepo),
    sessionsRepo,
    hasher,
    tokens,
    db,
  });
  const userAuth = createAuthService({
    population: "user",
    principals: userPrincipalAdapter(usersRepo),
    sessionsRepo,
    hasher,
    tokens,
    db,
  });
  const usersSvc = createUsersService({ usersRepo, hasher, db });

  return {
    config,
    db,
    logger,
    services: { staffAuth, userAuth, users: usersSvc /* … */ },
    controllers: {
      staffAuth: createAuthController(staffAuth),
      userAuth: createAuthController(userAuth),
      users: createUsersController(usersSvc),
      health: createHealthController(createHealthService([dbIndicator(db)])),
    },
  } as const;
};
export type Container = ReturnType<typeof buildContainer>;
```

`createApp(container)` builds routers from `container.controllers`. Tests call `buildContainer` with a test db, or call a single `create*Service` with hand-rolled fake repositories (plain objects with the same function signatures — trivially satisfied because repository types are structural).

Rules:

- No classes, no `this`, no decorators, no `new` in application code (third-party constructors excepted, wrapped in a `create*` function).
- Dependencies are passed in; nothing imports a singleton `db` or `logger`.
- Factories return `as const` objects; types are `ReturnType<typeof create*>`.
- Repositories accept `DbExecutor` (db or transaction) as the **last, optional** parameter for transactional composition (ADR-0006).
- Controllers are thin: parse validated input, call service with `req.ctx` first, respond via `respond.*` (ADR-0012).
- One module may depend on another module's **service**, never its repository.
  **Amended 2026-08-18 (step 8):** with one stated exception — a **principal
  adapter**. `auth.principals.ts` takes `StaffRepository` and `UsersRepository`
  and translates them into the `PrincipalAdapter` that ADR-0017 §Principal
  abstraction requires. Going through a service instead would mean a
  `StaffService` whose only caller is authentication and whose methods are
  `findByEmail`/`findById` — a pass-through layer that adds a file and hides
  nothing. The adapter is where the exception is confined: it is the only file
  in `modules/auth` that imports another module, it holds no logic beyond the
  translation, and the container is what wires it (see the example above).
- Modules export nothing to the outside except factories, schemas, mappers and types.

### Naming

- Files: `<module>.<layer>.ts`; factories: `create<Module><Layer>` (`createUsersService`); types: `UsersService`, `UsersRepository`.
- Service functions are use-case verbs (`register`, `changePassword`, `listForAdmin`), not HTTP verbs.
- Pure helpers named as verbs (`toUserResource`, `applyListQuery`, `assertOwnerOrRole`).
- DTO types come from zod schemas: `CreateUserBody = z.infer<typeof createUserBody>`.

## Consequences

- A new feature = new folder with the same shape; reviewers know where to look.
- Business logic unit-tests need no HTTP; fake repositories are plain object literals; repository tests run against the test DB.
- Structural typing + `ReturnType` avoids interface/class duplication and keeps refactors cheap.
- Explicit wiring in `container.ts` grows linearly; if it becomes unwieldy (>~30 modules) it can be split into per-domain `build*` functions composed at the root — still no container library needed.

## Alternatives considered

- Layer-first layout (`controllers/`, `services/`, …): scales poorly, features scatter across folders.
- Classes with constructor injection: equivalent capability, but adds `this` binding pitfalls in Express handlers, interface/impl duplication, and invites inheritance; rejected per stakeholder preference for a functional codebase.
- Decorator DI (tsyringe, inversify, NestJS): implicit, reflection-metadata dependent, class-based.
- Skipping the repository layer: faster to write, but couples services to SQL and complicates unit tests.
