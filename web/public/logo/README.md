# Logo assets

Drop Folionix logo files here. Files under `web/public/` are served from the
site root, so a file named `folionix.svg` in this folder is reachable at
`/logo/folionix.svg`.

Reference it in components via the Next `Image` component or a plain path:

```tsx
import Image from "next/image";

<Image src="/logo/folionix.svg" alt="Folionix" width={120} height={32} priority />
```

Suggested files (per docs/references/brand_guidelines.md):
- `folionix.svg` — primary wordmark/logo (prefer SVG; scales crisply)
- `folionix-mark.svg` — icon/mark only (square, for tight spaces)
- `favicon.ico` already lives at `web/app/favicon.ico` (App Router convention)
