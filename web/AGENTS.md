<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Build & Deploy

- `docker/Dockerfile.web`: two-stage workspace build (`builder` → `runner`) using Next standalone output; `npm ci -w web` uses a BuildKit cache mount (`/root/.npm`), so lockfile changes reinstall fast on warm caches.
- `NEXT_PUBLIC_*` env vars are **not** baked at build time — the root layout injects them at runtime via `window.__ENV` from the container env. Never add build-args for them.
- Image `marvellooni/folionix-web` is built multi-arch by `.github/workflows/build.yml` (native amd64 + arm64 runners, gha layer cache, digest push + manifest merge), gated on `npm run build` passing in the `test-web` job.