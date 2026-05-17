/** Instagram caption hard cap used after we append the default CTA. */
export const SOCIAL_CAPTION_CHAR_CAP = 2200;

export const DEFAULT_CAPTION_CTA_STORAGE_KEY = "v2c-default-caption-cta-v1";
export const MAX_DEFAULT_CAPTION_CTA_CHARS = 500;

export function getDefaultCaptionCtaFromStorage(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(DEFAULT_CAPTION_CTA_STORAGE_KEY);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

export function setDefaultCaptionCtaToStorage(text: string): void {
  if (typeof window === "undefined") return;
  const trimmed = text.slice(0, MAX_DEFAULT_CAPTION_CTA_CHARS);
  try {
    localStorage.setItem(DEFAULT_CAPTION_CTA_STORAGE_KEY, trimmed);
  } catch {
    // ignore
  }
}

/** Multipart / JSON fields from the client (same cap as storage). */
export function coerceDefaultCaptionCtaField(
  raw: string | undefined | null
): string | undefined {
  const t = String(raw ?? "").trim();
  if (!t) return undefined;
  return t.slice(0, MAX_DEFAULT_CAPTION_CTA_CHARS);
}

function isHashtagOnlyLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const parts = t.split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.every((p) => /^#\S+$/.test(p));
}

/** True if we already appended this CTA as the closing block (avoids suffix false positives on `endsWith(cta)`). */
function bodyAlreadyEndsWithDefaultCta(bodyTrim: string, ctaT: string): boolean {
  if (!ctaT || !bodyTrim) return false;
  if (bodyTrim === ctaT) return true;
  return bodyTrim.endsWith("\n\n" + ctaT);
}

/**
 * Inserts `cta` after the main caption body and before a trailing block of
 * hashtag-only lines (each line is only #tokens). If there is no such block,
 * appends the CTA at the end. Skips insertion when the body already ends with
 * `\n\n` + `cta` (trimmed), or equals `cta` alone (already applied).
 */
export function appendDefaultCaptionCtaBeforeHashtags(
  caption: string,
  cta: string
): string {
  const ctaT = cta.trim();
  if (!ctaT) return caption;

  const normalized = caption.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  const trimmedLines = lines.slice(0, end);

  if (trimmedLines.length === 0) return ctaT;

  let start = trimmedLines.length;
  while (start > 0 && isHashtagOnlyLine(trimmedLines[start - 1])) {
    start--;
  }

  const body = trimmedLines.slice(0, start).join("\n").trimEnd();
  const tagBlock =
    start < trimmedLines.length
      ? trimmedLines.slice(start).join("\n").trim()
      : "";

  const bodyTrim = body.trim();
  if (bodyAlreadyEndsWithDefaultCta(bodyTrim, ctaT)) {
    if (tagBlock) return `${bodyTrim}\n\n${tagBlock}`.trim();
    return bodyTrim;
  }

  const inserted = bodyTrim ? `${bodyTrim}\n\n${ctaT}` : ctaT;
  if (tagBlock) return `${inserted}\n\n${tagBlock}`.trim();
  return inserted;
}

export function applyCaptionCtaAndCap(
  caption: string,
  cta: string | undefined
): string {
  const withCta = appendDefaultCaptionCtaBeforeHashtags(
    caption,
    cta?.trim() ?? ""
  );
  return withCta.slice(0, SOCIAL_CAPTION_CHAR_CAP);
}
