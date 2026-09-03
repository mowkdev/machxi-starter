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

RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=admin

FROM nginx:1.29-alpine AS runtime

COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html

EXPOSE 80
