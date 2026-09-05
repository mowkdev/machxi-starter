# The customer SPA image (ADR-0059 §4; the app is ADR-0055).
#
# Built from the repository root — `docker build -f apps/customer/Dockerfile .`
# — for the reason the API's is: a pnpm workspace installs from the top.
#
# **`VITE_*` values are build arguments, and that makes this image
# environment-specific.** Vite inlines them into the served bundle, so there is
# no run-time configuration to inject: an image built for staging cannot be
# promoted to production by changing a variable, and the same commit is built
# once per environment. That is a property of the tool, not an oversight — see
# `apps/customer/.env.example` on why everything here is compile-time public.
#
# One argument fewer than the admin image: `VITE_CUSTOMER_APP_URL` points *at*
# this app and is the admin's to know (ADR-0057 §7).

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true
RUN corepack enable
WORKDIR /repo

# Declared and immediately promoted to ENV, because Vite reads `VITE_*` from
# the process environment as well as from `.env` files — and `turbo.json`'s
# `build` task lists `VITE_*` in its `env`, without which Turborepo's strict
# env mode would hand the build an empty one.
ARG VITE_API_URL
# The brand this build's device-storage keys are prefixed with (ADR-0064 §1).
# Defaulted here rather than required, like VITE_I18N_PSEUDO and unlike
# VITE_API_URL: the API's own APP_ID defaults to the same word, so an image
# built without it agrees with an API deployed without it.
ARG VITE_APP_ID=machxi
ARG VITE_I18N_PSEUDO=false
# Self-service registration (ADR-0067 §6). Defaulted on for the reason the
# API's own FEATURE_USER_REGISTRATION is: an image built without it agrees with
# an API deployed without it. The API's flag is still the control — this one
# only decides whether the screen is in the bundle.
ARG VITE_FEATURE_USER_REGISTRATION=true
ENV VITE_API_URL=$VITE_API_URL \
    VITE_APP_ID=$VITE_APP_ID \
    VITE_I18N_PSEUDO=$VITE_I18N_PSEUDO \
    VITE_FEATURE_USER_REGISTRATION=$VITE_FEATURE_USER_REGISTRATION

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=customer

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
RUN cp -r apps/customer/dist /web && find /web -name '*.map' -delete

FROM nginx:1.29-alpine AS runtime

COPY apps/customer/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web /usr/share/nginx/html

EXPOSE 80
