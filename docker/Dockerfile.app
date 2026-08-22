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
COPY --from=builder /repo/lib ./lib
USER appuser
