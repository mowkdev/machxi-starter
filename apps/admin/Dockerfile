# The admin SPA image (ADR-0059 §4).
#
# Built from the repository root — `docker build -f apps/admin/Dockerfile .` —
# for the reason the API's is: a pnpm workspace installs from the top.
#
# **`VITE_*` values are build arguments, and that makes this image
# environment-specific.** Vite inlines them into the served bundle, so there is
# no run-time configuration to inject: an image built for staging cannot be
# promoted to production by changing a variable, and the same commit is built
# once per environment. That is a property of the tool, not an oversight — see
# `apps/admin/.env.example` on why everything here is compile-time public.

FROM node:24-bookworm-slim AS build
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true
RUN corepack enable
WORKDIR /repo

# **The dependencies are fetched from the lockfile alone, before the source is
# copied** (ADR-0078 §5). `pnpm fetch` reads nothing but `pnpm-lock.yaml` and
# fills the store, so this layer is rebuilt when a dependency moves and at no
# other time; the `COPY . .` below is what every source edit invalidates, and
# the install after it links from the store with `--offline` rather than
# downloading the tree again. The root `package.json` rides along only for its
# `packageManager` field, which is how Corepack picks the pinned pnpm, and
# `pnpm-workspace.yaml` for the settings pnpm 12 reads there and nowhere else
# — `overrides`, `allowBuilds`, and the cooldown with the `trustLockfile` that
# keeps it from refusing a lockfile committed today.
#
# It sits above the build arguments, too: an `ARG` promoted to `ENV` is part of
# every later layer's cache key, and a fetch that re-ran for each environment's
# API origin would be the waste this layer exists to remove.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# Declared and immediately promoted to ENV, because Vite reads `VITE_*` from
# the process environment as well as from `.env` files — and `turbo.json`'s
# `build` task lists `VITE_*` in its `env`, without which Turborepo's strict
# env mode would hand the build an empty one.
ARG VITE_API_URL
ARG VITE_CUSTOMER_APP_URL
# The brand this build's device-storage keys are prefixed with (ADR-0064 §1).
# Defaulted here rather than required, like VITE_I18N_PSEUDO and unlike
# VITE_API_URL: the API's own APP_ID defaults to the same word, so an image
# built without it agrees with an API deployed without it.
ARG VITE_APP_ID=machxi
ARG VITE_I18N_PSEUDO=false
ENV VITE_API_URL=$VITE_API_URL \
    VITE_CUSTOMER_APP_URL=$VITE_CUSTOMER_APP_URL \
    VITE_APP_ID=$VITE_APP_ID \
    VITE_I18N_PSEUDO=$VITE_I18N_PSEUDO

COPY . .

RUN pnpm install --frozen-lockfile --offline

# **The build's release label, stamped into the bundle** (ADR-0081 §2), under
# the name the API's image and `turbo.json` use — no `VITE_`-named twin.
# Promoted to `ENV` because `app-version.ts` reads it from the process
# environment and `turbo.json`'s `build` task passes it through, as it does
# `VITE_*`. The sidebar footer shows it alone. **No `GIT_SHA`** (`D32.5`): the
# commit is the API's `/health` fact, and this image does not take it.
#
# Declared here, below the install, rather than beside the `VITE_*` arguments
# above: the label changes with every release, where an API origin does not,
# and a new label should rebuild the bundle and nothing under it. Omitted, it
# arrives as the empty string, which `app-version.ts` reads as unset: the
# footer says `dev` (ADR-0081 §1).
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}

RUN pnpm turbo run build --filter=admin

# **The web root is a copy of `dist/` with the sourcemaps taken out, and it is
# made here rather than in the runtime stage** (ADR-0062 §4, `D14.9`).
#
# `build.sourcemap: "hidden"` emits a `.map` beside every chunk and references
# none of them from the bundle. The maps are for whoever holds the build — the
# error reporter of ADR-0066 §3 — and serving them from a public web root would
# hand the app's whole source to anyone who guesses a file name.
#
# Deleting them *after* a `COPY` into the final image would not do it: layers
# are additive, so the `COPY` layer still carries every map and a `RUN rm` only
# writes a whiteout over it — anyone who can pull the image reads them out of
# the lower layer with `docker save`. Pruning in a discarded stage is what
# keeps them out of a published layer, and `dist/` itself is untouched, so a
# release pipeline can still take the maps from there.
RUN cp -r apps/admin/dist /web && find /web -name '*.map' -delete

# **nginx's unprivileged image, not the stock one** (ADR-0078 §5). The stock
# image starts its master process as root so that it can bind port 80 and then
# drops the workers to `nginx`; this one is built to run as uid 101 from the
# first instruction, with its pid file and temp paths under `/tmp` and its
# port at 8080 — above 1024, which is why nothing here needs root at all.
# `nginx.conf` listens there, and the compose file maps it.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime

# Stated even though it is the base image's own default, so that a `USER root`
# added above a later instruction cannot leak into the running container
# unnoticed: the hygiene case reads the last `USER` of this stage.
USER 101

COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web /usr/share/nginx/html

# The policy's `connect-src` names the API origin, and nginx cannot read what
# Vite inlined — so the same build argument is read a second time, here, and
# written into the server config (ADR-0073 §9). **The same argument, not a
# second one named for the header**: the origin the bundle fetches from and
# the origin the policy allows are one fact, and two variables for one fact is
# how a deployment ends up with a bundle that is refused by its own policy.
# An `ARG` is per stage, so it is declared again; `--build-arg` still fills it.
#
# The build refuses anything but an origin — scheme, host, optional port and
# nothing after it — because an image that passed one silently would answer
# every request with a policy that blocks its own API, a broken app that looks
# like a deployed one (`D20.8`'s `security-reviewer`). A path is the case that
# matters: `https://example.com/api` is a URL the bundle happily builds on and
# a CSP source that matches that exact path and no other, so every request the
# app makes is refused. The same check keeps `;` and whitespace out of the
# policy, where either would widen it, and every character `sed` treats as
# its own. The placeholder is then checked gone, and nginx checks the result.
ARG VITE_API_URL
RUN printf '%s' "$VITE_API_URL" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$' \
    && sed -i "s|__API_ORIGIN__|$VITE_API_URL|" /etc/nginx/conf.d/default.conf \
    && ! grep -q "__API_ORIGIN__" /etc/nginx/conf.d/default.conf \
    && nginx -t

EXPOSE 8080

# Liveness of the server, answered by `nginx.conf`'s `/healthz` location and
# nothing else: a static file server has no dependency whose blip should
# restart it, so the question is only whether nginx still answers. BusyBox's
# `wget` rather than `curl`, because it is part of the Alpine base itself —
# nothing is installed to run the check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/healthz"]
