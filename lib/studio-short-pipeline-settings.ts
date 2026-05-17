/**
 * Video to Short pipeline toggles for the studio (create + reprocess).
 * Defaults live in code; persisted in localStorage for the next queue run.
 */

export type ShortAudioMode = "original" | "fast" | "deepfilter";

export type StudioShortReframeTuning = {
  sample_interval_sec: number;
  ema_alpha: number;
  pad_hook: number;
  pad_body: number;
  min_crop_width_frac: number;
  max_crop_width_frac: number;
  max_center_shift_frac: number;
  max_size_step_frac: number;
};

export type StudioShortPipelineSettings = {
  audioMode: ShortAudioMode;
  smartEditorial: boolean;
  bookendZoom: boolean;
  smartReframe: boolean;
  reframe: StudioShortReframeTuning;
};

export const STUDIO_SHORT_REFRAME_DEFAULTS: StudioShortReframeTuning = {
  sample_interval_sec: 0.18,
  ema_alpha: 0.22,
  pad_hook: 0.08,
  pad_body: 0.09,
  min_crop_width_frac: 0.46,
  max_crop_width_frac: 0.88,
  max_center_shift_frac: 0.05,
  max_size_step_frac: 0.09,
};

export const STUDIO_SHORT_PIPELINE_DEFAULTS: StudioShortPipelineSettings = {
  audioMode: "deepfilter",
  smartEditorial: true,
  bookendZoom: true,
  smartReframe: true,
  reframe: { ...STUDIO_SHORT_REFRAME_DEFAULTS },
};

export const SHORT_PIPELINE_SETTINGS_STORAGE_KEY =
  "v2c-short-pipeline-settings-v1";

const AUDIO_MODES: ShortAudioMode[] = ["original", "fast", "deepfilter"];

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function readReframeNumber(
  raw: Record<string, unknown>,
  key: keyof StudioShortReframeTuning,
  min: number,
  max: number,
  fallback: number
): number {
  const n = Number(raw[key]);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

function parseStoredPipeline(
  raw: unknown
): StudioShortPipelineSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const audio =
    typeof o.audioMode === "string" && AUDIO_MODES.includes(o.audioMode as ShortAudioMode)
      ? (o.audioMode as ShortAudioMode)
      : null;
  if (!audio) return null;

  const reframeRaw =
    o.reframe && typeof o.reframe === "object"
      ? (o.reframe as Record<string, unknown>)
      : {};
  const d = STUDIO_SHORT_REFRAME_DEFAULTS;

  return {
    audioMode: audio,
    smartEditorial: o.smartEditorial !== false,
    bookendZoom: o.bookendZoom !== false,
    smartReframe: o.smartReframe !== false,
    reframe: {
      sample_interval_sec: readReframeNumber(
        reframeRaw,
        "sample_interval_sec",
        0.05,
        1,
        d.sample_interval_sec
      ),
      ema_alpha: readReframeNumber(reframeRaw, "ema_alpha", 0.05, 1, d.ema_alpha),
      pad_hook: readReframeNumber(reframeRaw, "pad_hook", 0, 0.5, d.pad_hook),
      pad_body: readReframeNumber(reframeRaw, "pad_body", 0, 0.5, d.pad_body),
      min_crop_width_frac: readReframeNumber(
        reframeRaw,
        "min_crop_width_frac",
        0.2,
        1,
        d.min_crop_width_frac
      ),
      max_crop_width_frac: readReframeNumber(
        reframeRaw,
        "max_crop_width_frac",
        0.2,
        1,
        d.max_crop_width_frac
      ),
      max_center_shift_frac: readReframeNumber(
        reframeRaw,
        "max_center_shift_frac",
        0,
        0.5,
        d.max_center_shift_frac
      ),
      max_size_step_frac: readReframeNumber(
        reframeRaw,
        "max_size_step_frac",
        0,
        0.5,
        d.max_size_step_frac
      ),
    },
  };
}

export function getStudioShortPipelineSettingsFromStorage(): StudioShortPipelineSettings {
  if (typeof window === "undefined") {
    return { ...STUDIO_SHORT_PIPELINE_DEFAULTS, reframe: { ...STUDIO_SHORT_REFRAME_DEFAULTS } };
  }
  try {
    const raw = window.localStorage.getItem(SHORT_PIPELINE_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        ...STUDIO_SHORT_PIPELINE_DEFAULTS,
        reframe: { ...STUDIO_SHORT_REFRAME_DEFAULTS },
      };
    }
    const parsed = parseStoredPipeline(JSON.parse(raw));
    if (parsed) {
      // Studio used to default to `fast`; align persisted settings with backend default.
      if (parsed.audioMode === "fast") {
        const migrated = { ...parsed, audioMode: "deepfilter" as const };
        setStudioShortPipelineSettingsToStorage(migrated);
        return migrated;
      }
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return {
    ...STUDIO_SHORT_PIPELINE_DEFAULTS,
    reframe: { ...STUDIO_SHORT_REFRAME_DEFAULTS },
  };
}

export function setStudioShortPipelineSettingsToStorage(
  settings: StudioShortPipelineSettings
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SHORT_PIPELINE_SETTINGS_STORAGE_KEY,
      JSON.stringify(settings)
    );
  } catch {
    /* quota / disabled */
  }
}

/** Merge partial overrides (e.g. from UI) onto code defaults. */
export function resolveStudioShortPipelineSettings(
  partial?: Partial<StudioShortPipelineSettings> | null
): StudioShortPipelineSettings {
  const base = STUDIO_SHORT_PIPELINE_DEFAULTS;
  if (!partial) {
    return { ...base, reframe: { ...base.reframe } };
  }
  return {
    audioMode: partial.audioMode ?? base.audioMode,
    smartEditorial:
      typeof partial.smartEditorial === "boolean"
        ? partial.smartEditorial
        : base.smartEditorial,
    bookendZoom:
      typeof partial.bookendZoom === "boolean"
        ? partial.bookendZoom
        : base.bookendZoom,
    smartReframe:
      typeof partial.smartReframe === "boolean"
        ? partial.smartReframe
        : base.smartReframe,
    reframe: { ...base.reframe, ...partial.reframe },
  };
}
