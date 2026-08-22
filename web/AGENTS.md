<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Build & Deploy

- `web/Dockerfile`: three-stage build (`deps` → `builder` → `runner`) using Next standalone output; `npm ci` uses a BuildKit cache mount (`/root/.npm`), so lockfile changes reinstall fast on warm caches.
- `NEXT_PUBLIC_*` env vars are **not** baked at build time — the root layout injects them at runtime via `window.__ENV` from the container env. Never add build-args for them.
- Image `marvellooni/folionix-web` is built multi-arch by `.github/workflows/build.yml` (native amd64 + arm64 runners, gha layer cache, digest push + manifest merge), gated on `npm run build` passing in the `test-web` job.