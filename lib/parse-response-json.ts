/**
 * Parse JSON from a fetch Response. Many failures return HTML or plain text
 * (e.g. "Internal Server Error"), which breaks `response.json()` with a cryptic parse error.
 */
export async function parseResponseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const flat = text.trim().replace(/\s+/g, " ");
    const snippet = flat.slice(0, 280);
    const isHtml404 =
      res.status === 404 &&
      (flat.startsWith("<!DOCTYPE") ||
        flat.startsWith("<html") ||
        flat.includes("404: This page could not be found"));
    const hint404 = isHtml404
      ? " The server returned an HTML 404 page instead of JSON—usually the URL did not match a Next.js API route (typo, stale deploy missing that route, reverse proxy not forwarding `/api`, or `basePath` set without `NEXT_PUBLIC_BASE_PATH` on client fetches). Check the Network tab for the exact request URL."
      : "";
    const hint =
      res.status === 500
        ? " Common causes: video larger than Next’s default body stream limit (fixed via experimental.middlewareClientMaxBodySize in next.config), missing OPENAI_API_KEY, or a pipeline error—check the terminal running `next dev` for the real stack trace."
        : hint404;
    throw new Error(
      snippet
        ? `Request failed (${res.status}): ${snippet}${hint}`
        : `Request failed (${res.status}).${hint}`
    );
  }
}
