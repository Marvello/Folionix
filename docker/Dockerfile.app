# syntax=docker/dockerfile:1.7
# docker/Dockerfile.app
FROM node:24-alpine AS deps
WORKDIR /repo
ARG NPM_TOKEN
COPY .npmrc package.json package-lock.json ./
COPY lib/ ./lib/
COPY app/package.json ./app/
RUN echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" >> .npmrc && \
    npm ci --omit=dev -w app && \
    rm -f .npmrc

FROM node:24-alpine AS builder
WORKDIR /repo
ARG NPM_TOKEN
COPY .npmrc package.json package-lock.json ./
COPY lib/ ./lib/
COPY app/package.json ./app/
RUN echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" >> .npmrc && \
    npm ci -w app && \
    rm -f .npmrc
COPY app/ ./app/
RUN cd app && node build.mjs

FROM node:24-alpine AS runner
WORKDIR /app
RUN addgroup -S appuser && adduser -S appuser -G appuser
COPY --from=builder /repo/app/dist ./dist
COPY --from=deps /repo/node_modules ./node_modules
# Some prod deps can't hoist to the root node_modules (e.g. nodemailer@10 is
# blocked by next-auth's nodemailer ^7||^8 peer), so npm nests them under the
# workspace. Merge those in too or the esbuild-external imports 404 at runtime.
COPY --from=deps /repo/app/node_modules ./node_modules
COPY --from=builder /repo/lib ./lib
# Migration SQL is read at runtime by src/db/migrate.ts (found by walking up
# from the workdir for db/migrations), so it must ship inside the image.
COPY db/ ./db/
USER appuser
