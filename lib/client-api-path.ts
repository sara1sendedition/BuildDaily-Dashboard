/**
 * Browser-side path for same-origin App Router `/api/*` calls.
 *
 * Set `NEXT_PUBLIC_BASE_PATH` (e.g. `/my-app`) when the app is mounted under a subpath;
 * `next.config.ts` uses the same variable for `basePath` so pages and `/api/*` stay aligned.
 */
export function clientApiPath(path: string): string {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
  const prefix = raw.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${prefix}${p}`;
}
