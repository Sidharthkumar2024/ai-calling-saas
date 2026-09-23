const RETRYABLE_PROVIDER_STATUSES = new Set([
  408, 425, 429, 500, 502, 503, 504,
]);

function transportDetail(error: unknown) {
  if (!(error instanceof Error)) {
    if (typeof error === 'string') return error;
    if (error == null) return 'unknown error';
    try {
      return JSON.stringify(error);
    } catch {
      return 'unknown error';
    }
  }
  const cause = error.cause as
    | { code?: unknown; message?: unknown }
    | undefined;
  const causeCode = typeof cause?.code === 'string' ? cause.code : '';
  const causeMessage =
    typeof cause?.message === 'string' ? cause.message.trim() : '';
  return [error.message, causeCode, causeMessage]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(' · ');
}

/**
 * Runs one provider HTTP request with a deliberately small retry budget.
 *
 * Voice turns are latency-sensitive, so we retry only failures that may heal
 * immediately (transport errors, timeout, throttling and 5xx). Authentication
 * and validation responses are returned to the adapter at once so it can move
 * to another provider instead of making the caller wait for the same rejected
 * key twice.
 *
 * `request` is a factory rather than a RequestInit so every attempt gets a new
 * AbortSignal and a fresh body. Reusing a consumed FormData/body stream is a
 * common reason a retry itself throws `fetch failed`.
 */
export async function fetchProviderWithRetry(
  provider: string,
  request: (attempt: number) => Promise<Response>,
  options: { attempts?: number; baseDelayMs?: number } = {},
) {
  const attempts = Math.max(1, Math.min(3, options.attempts ?? 2));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 120);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request(attempt);
      if (
        attempt === attempts ||
        !RETRYABLE_PROVIDER_STATUSES.has(response.status)
      )
        return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts)
        throw new Error(
          `${provider} transport failed after ${attempts} attempts: ${transportDetail(error)}`,
          { cause: error },
        );
    }

    if (baseDelayMs)
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * attempt),
      );
  }

  throw new Error(
    `${provider} transport failed: ${transportDetail(lastError)}`,
    { cause: lastError },
  );
}

export function providerFailureDetail(error: unknown) {
  return transportDetail(error).replace(/\s+/g, ' ').trim().slice(0, 240);
}
