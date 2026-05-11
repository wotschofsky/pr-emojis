export interface RetryLogger {
  set(fields: Record<string, unknown>): void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  log: RetryLogger,
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 200;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      log.set({ [`attempt_${attempt}_error`]: String(err) });
      if (!isRetryable(err) || attempt === maxAttempts) break;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

export function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.startsWith("parse_failed")) return true;
  // AI SDK throws APICallError with `.statusCode`; treat 5xx and undefined as retryable.
  const status =
    (err as { statusCode?: number; status?: number })?.statusCode ??
    (err as { status?: number })?.status;
  if (status === undefined) return true;
  return status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
