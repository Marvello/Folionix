import { build } from 'esbuild'

await build({
  entryPoints: [
    'src/bot/bot.ts',
    'src/graph/runner.ts',
    'src/graph/worker.ts',
    'src/services/portfolio.ts',
    'src/services/weekReview.ts',
  ],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: 'dist',
  packages: 'external',
  sourcemap: true,
})
