// Cap concurrent async work so a large batch can't burst a provider's rate
// limits. Preserves the PromiseSettledResult shape callers already log over.
export async function mapPool<T, R>(
  items: T[], limit: number, fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out = new Array<PromiseSettledResult<R>>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++
      try { out[idx] = { status: 'fulfilled', value: await fn(items[idx]) } }
      catch (reason) { out[idx] = { status: 'rejected', reason } }
    }
  })
  await Promise.all(workers)
  return out
}
