# syntax=docker/dockerfile:1.7
# docker/Dockerfile.app
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY lib/ ./lib/
COPY app/package.json ./app/
# mkdir: app/node_modules only exists when npm has to nest something (see the
# runner stage) — keep the COPY there valid either way.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev -w app && mkdir -p app/node_modules

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS builder
WORKDIR /repo
COPY package.json package-lock.json ./
COPY lib/ ./lib/
COPY app/package.json ./app/
RUN --mount=type=cache,target=/root/.npm \
    npm ci -w app
COPY app/ ./app/
RUN cd app && node build.mjs

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS runner
ARG GIT_COMMIT=dev
ENV GIT_COMMIT=$GIT_COMMIT
WORKDIR /app
RUN addgroup -S appuser && adduser -S appuser -G appuser
COPY --from=builder /repo/app/dist ./dist
COPY --from=deps /repo/node_modules ./node_modules
# Some prod deps can't always hoist to the root node_modules (nodemailer@10
# was nested under the workspace while next-auth pinned a ^7||^8 peer), so npm
# nests them under the workspace. Merge those in too or the esbuild-external
# imports 404 at runtime. Empty dir when everything hoisted.
COPY --from=deps /repo/app/node_modules ./node_modules
# Migration SQL is read at runtime by src/db/migrate.ts (found by walking up
# from the workdir for db/migrations), so it must ship inside the image.
COPY db/ ./db/
USER appuser
