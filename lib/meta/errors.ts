export type MetaGraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
    /** When true, Meta suggests retrying later (transient platform issue). */
    is_transient?: boolean;
  };
};

export class MetaGraphError extends Error {
  readonly body: MetaGraphErrorBody;

  constructor(body: MetaGraphErrorBody) {
    const msg =
      body.error?.message ??
      (typeof body === "object" ? JSON.stringify(body) : String(body));
    super(msg);
    this.name = "MetaGraphError";
    this.body = body;
  }
}

export function assertOk(
  res: Response,
  data: MetaGraphErrorBody & Record<string, unknown>
): void {
  if (!res.ok || data.error) {
    throw new MetaGraphError(data as MetaGraphErrorBody);
  }
}

/** Parse Graph `fetch` bodies safely (HTML/502 pages become a clear MetaGraphError). */
export async function readGraphJsonBody(
  res: Response
): Promise<MetaGraphErrorBody & Record<string, unknown>> {
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    const preview = text.slice(0, 180).replace(/\s+/g, " ").trim();
    throw new MetaGraphError({
      error: {
        message: `Graph API returned non-JSON (HTTP ${res.status}).${
          preview ? ` Body starts: ${preview}` : " Empty body."
        }`,
      },
    });
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new MetaGraphError({
      error: {
        message: `Graph API returned unexpected JSON shape (HTTP ${res.status}).`,
      },
    });
  }
  return parsed as MetaGraphErrorBody & Record<string, unknown>;
}

/** User-visible copy: Meta’s message plus trace id and short guidance when helpful. */
export function formatMetaUserFacingMessage(err: MetaGraphError): string {
  const e = err.body.error;
  const base = (e?.message ?? err.message).trim();
  const parts: string[] = [base];
  if (typeof e?.code === "number" || typeof e?.error_subcode === "number") {
    const codeBits = [
      typeof e?.code === "number" ? `code ${e.code}` : null,
      typeof e?.error_subcode === "number" ? `subcode ${e.error_subcode}` : null,
    ].filter(Boolean);
    parts.push(`(${codeBits.join(", ")})`);
  }
  if (e?.fbtrace_id) {
    parts.push(`Meta trace id: ${e.fbtrace_id}`);
  }
  if (e?.is_transient) {
    parts.push(
      "Meta marked this error as transient—wait a minute or two and try Publish again."
    );
  } else if (
    /unexpected error has occurred/i.test(base) ||
    /retry your request later/i.test(base)
  ) {
    parts.push(
      "This is Meta’s generic error: often a short-lived outage, rate limiting, or a token/permission glitch. Retry shortly; if it keeps happening, regenerate your Page access token and confirm it in the Access Token Debugger."
    );
  }
  return parts.join(" ");
}
