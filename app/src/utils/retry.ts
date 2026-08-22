export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts - 1 && baseDelayMs > 0) {
        await new Promise<void>(r => setTimeout(r, baseDelayMs * 2 ** attempt))
      }
    }
  }
  throw lastErr
}
