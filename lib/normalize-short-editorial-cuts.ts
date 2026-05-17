/**
 * Normalizes `editorial_cuts` from Video to Short job JSON for display.
 * Backend shape may vary; we accept common field names.
 */
export type ShortEditorialCutRow = {
  timeRange: string;
  reason: string;
  snippet: string;
};

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function formatSecLabel(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

function numeric(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function strFromStringOrStringArray(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function unwrapEditorialCutsList(raw: unknown): unknown[] | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t.startsWith("[") && !t.startsWith("{")) return null;
    try {
      v = JSON.parse(t) as unknown;
    } catch {
      return null;
    }
  }
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.cuts)) return o.cuts;
    if (Array.isArray(o.editorial_cuts)) return o.editorial_cuts;
    if (Array.isArray(o.editorialCuts)) return o.editorialCuts;
  }
  return null;
}

export function normalizeShortEditorialCuts(raw: unknown): ShortEditorialCutRow[] {
  const list = unwrapEditorialCutsList(raw);
  if (!list) return [];
  const rows: ShortEditorialCutRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;

    let timeRange =
      str(o.time_range) ||
      str(o.timeRange) ||
      str(o.range) ||
      str(o.original_range) ||
      str(o.timeline) ||
      "";

    const startLabel = str(o.start_label) || str(o.startLabel);
    const endLabel = str(o.end_label) || str(o.endLabel);
    if (!timeRange && (startLabel || endLabel)) {
      timeRange = [startLabel, endLabel].filter(Boolean).join(" — ");
    }

    if (!timeRange) {
      const t0 =
        numeric(o.start_sec) ??
        numeric(o.startSec) ??
        numeric(o.start) ??
        numeric(o.t0) ??
        numeric(o.from_sec);
      const t1 =
        numeric(o.end_sec) ??
        numeric(o.endSec) ??
        numeric(o.end) ??
        numeric(o.t1) ??
        numeric(o.to_sec);
      if (t0 !== null && t1 !== null) {
        timeRange = `${formatSecLabel(t0)} — ${formatSecLabel(t1)}`;
      } else if (t0 !== null) {
        timeRange = formatSecLabel(t0);
      } else if (t1 !== null) {
        timeRange = formatSecLabel(t1);
      }
    }

    const dur =
      str(o.duration_sec) || str(o.durationSec) || str(o.duration);
    if (!timeRange && dur) {
      timeRange = `≈${dur}s removed`;
    }

    const reason =
      str(o.reason) ||
      str(o.rationale) ||
      str(o.category) ||
      str(o.why) ||
      str(o.label) ||
      "—";

    const snippet =
      str(o.snippet) ||
      str(o.removed_text) ||
      str(o.removedText) ||
      strFromStringOrStringArray(o.removed) ||
      str(o.text) ||
      str(o.excerpt) ||
      str(o.words) ||
      str(o.quote) ||
      "—";

    if (!timeRange && reason === "—" && snippet === "—") continue;

    rows.push({
      timeRange: timeRange || "—",
      reason,
      snippet,
    });
  }
  return rows;
}
