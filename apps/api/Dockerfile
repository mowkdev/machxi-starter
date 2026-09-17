# The API image (ADR-0059 §4), the migration runner with it (§5) and the
# session prune beside them (ADR-0073 §3).
#
# Built from the repository root — `docker build -f apps/api/Dockerfile .` —
# because a pnpm workspace installs from the top: the lockfile, the workspace
# file and every `@repo/*` package this app links live above this directory.
#
# What ships is the bundle and its runtime closure, not the workspace. Two
# constraints from `apps/api/tsdown.config.ts` have to survive that, and both
# fail at the first completed request rather than at build time:
#
#   * `argon2` is a native CJS addon, kept external, so its `.node` binary must
#     be present in `node_modules`;
#   * `pino` is external for the same reason `pino-http` is — one copy in the
#     process, or the two halves silently miss each other through pino's
#     private symbols.
#
# Both hold here because the runtime stage carries the real dependency closure
# (`pnpm deploy --prod`) rather than a hand-picked subset, and because it is
# the same Debian base the addon was installed on.

# ─── Base ─────────────────────────────────────────────────────────────────────
# Debian rather than Alpine: `argon2` is a native addon, and glibc is the
# platform its prebuilt binaries target. The saving from musl is not worth
# discovering the difference in production.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true
RUN corepack enable

# ─── Build ────────────────────────────────────────────────────────────────────
FROM base AS build
WORKDIR /repo

COPY . .

RUN pnpm install --frozen-lockfile

# `@repo/db` for the migration runner (§5), `api` for the server bundle. Turbo
# builds each package's dependencies first, so one command covers the graph.
RUN pnpm turbo run build --filter=api --filter=@repo/db

# The runtime closure of `apps/api`, production dependencies only.
#
# **`--legacy` is gone, re-verified on pnpm 12** (ADR-0073 §4): it was pnpm
# 10's flag for a workspace that does not inject its internal packages, where
# `deploy` refused rather than guessing. pnpm 12 does not refuse — it links the
# four `@repo/*` packages out of the virtual store — and what the image needs
# from this command is unchanged: one `pino`, and `argon2`'s prebuilt binary
# for this platform. A flag whose only job was to answer a question the tool no
# longer asks is a flag that outlives its reason.
#
# The two `dist/` directories are copied explicitly afterwards because `deploy`
# packs a workspace package the way npm would pack it, and `dist` is
# git-ignored — so what lands in `/out` is the source tree, and the bundles
# this image actually runs have to be put there by hand.
#
# `@repo/db`'s is copied **whole** rather than by entry name (`D20.5`): with a
# second entry beside the migration runner, rolldown emits the code they share
# as a chunk both import, and naming the two entry files would ship two
# bundles whose only import is missing. The names are still load-bearing —
# `compose.yaml` runs `dist/migrate.js` and `dist/prune-sessions.js` — and the
# two trees merge rather than collide because every other file on both sides
# is a content-hashed chunk.
#
# The `find` sweeps the
# top-level config files that came with it (tsconfig, eslint, the two vitest
# configs, this Dockerfile): none is read at run time, and a deployed artefact
# that still carries its own build configuration invites someone to trust it.
RUN pnpm deploy --filter=api --prod /out \
    && rm -rf /out/src /out/test /out/e2e /out/dist \
    && find /out -maxdepth 1 -type f ! -name package.json -delete \
    && cp -R /repo/apps/api/dist /out/dist \
    && cp -R /repo/packages/db/dist/. /out/dist/ \
    && cp -R /repo/packages/db/migrations /out/migrations

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app

# The image's own default, not configuration: every production guard in the
# config schema branches on it, and an absent value is a startup failure by
# design (ADR-0004). Everything else — `DATABASE_URL`, `JWT_ACCESS_SECRET`,
# `TRUST_PROXY`, `CORS_ORIGINS` — is injected by the deployment, and so is
# `DATABASE_URL_OWNER`, which this image reads only when it is run as the
# one-shot `migrate` service (ADR-0061 §1); the API process never sees it.
ENV NODE_ENV=production \
    PORT=4000

# `node` is a real, unprivileged user in the official image (uid 1000).
COPY --from=build --chown=node:node /out /app
USER node

EXPOSE 4000

# Liveness, never readiness (ADR-0016): this decides whether the orchestrator
# restarts the process, and a database blip must not restart a healthy one.
# `/health/ready` is what a load balancer polls, and it is deliberately not
# this. Node's own fetch rather than curl or wget, neither of which the slim
# image has — and adding one to run a health check is a package to keep
# patched for the life of the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health/live`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# The migrate service overrides this with `node dist/migrate.js`, and the prune
# service loops `node dist/prune-sessions.js` (`docker/prod/compose.yaml`). The
# API itself never migrates (ADR-0008) and never prunes — one image, three
# commands, which is what keeps the three from ever being different versions.
CMD ["node", "dist/main.js"]
