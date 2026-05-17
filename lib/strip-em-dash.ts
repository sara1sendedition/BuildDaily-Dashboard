const EM_DASH = /\u2014/g;

/** Replace Unicode em dashes (U+2014). Use on model output and user-facing strings. */
export function stripEmDashes(s: string): string {
  return s.replace(EM_DASH, " - ");
}
