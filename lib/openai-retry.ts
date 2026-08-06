/**
 * Retry helper for OpenAI calls that fail with transient rate limits.
 * Does not retry hard quota exhaustion (insufficient_quota) — that needs billing.
 */

const RATE_LIMIT =
  /(?:\b429\b|rate[_ ]?limit|too many requests|tokens per min|TPM|RPM)/i;
const TRANSIENT =
  /(?:server_error|ECONNRESET|ETIMEDOUT|socket hang up|temporarily unavailable)/i;
const QUOTA =
  /insufficient_quota|exceeded your current quota|billing_not_active|payment/i;

function errorText(err: unknown): { msg: string; status: number } {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status?: unknown }).status)
      : NaN;
  return { msg, status };
}

export function isOpenAIQuotaError(err: unknown): boolean {
  const { msg, status } = errorText(err);
  if (QUOTA.test(msg)) return true;
  // OpenAI SDK often uses 429 for both RPM and quota; quota text is the signal.
  if (status === 429 && QUOTA.test(msg)) return true;
  return false;
}

/** True only for OpenAI RPM/TPM limits — safe to re-queue without burning attempts. */
export function isOpenAIRateLimitError(err: unknown): boolean {
  if (isOpenAIQuotaError(err)) return false;
  const { msg, status } = errorText(err);
  return status === 429 || RATE_LIMIT.test(msg);
}

/** Transient errors worth retrying inside a single job attempt. */
function isRetryableOpenAIError(err: unknown): boolean {
  if (isOpenAIQuotaError(err)) return false;
  if (isOpenAIRateLimitError(err)) return true;
  const { msg, status } = errorText(err);
  return status === 500 || status === 502 || status === 503 || TRANSIENT.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withOpenAIRetries<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; label?: string },
): Promise<T> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 5);
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (isOpenAIQuotaError(e)) throw e;
      if (!isRetryableOpenAIError(e) || attempt >= maxAttempts) throw e;
      const backoffMs = Math.min(60_000, 1500 * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 400);
      console.warn(
        `[openai-retry]${opts?.label ? ` ${opts.label}` : ""} attempt ${attempt}/${maxAttempts} rate-limited; waiting ${backoffMs + jitter}ms`,
      );
      await sleep(backoffMs + jitter);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
