/**
 * Video to Short pipeline toggles for the studio (create + reprocess).
 * Defaults live in code (aligned with Video to Short ``app/config.py``).
 */

import {
  CODE_DEFAULT_SHORT_AUDIO_MODE,
  parseShortAudioMode,
  type ShortAudioMode,
} from "@/lib/short-audio-mode";

export type { ShortAudioMode };

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
  /** When true (default), uses lighter/faster audio for iteration. Turn off in Advanced for production DeepFilter. */
  devMode: boolean;
  audioMode: ShortAudioMode;
  smartEditorial: boolean;
  bookendZoom: boolean;
  smartReframe: boolean;
  reframe: StudioShortReframeTuning;
};

/** Audio mode applied while {@link StudioShortPipelineSettings.devMode} is on. */
export const DEV_MODE_SHORT_AUDIO_MODE: ShortAudioMode = "fast";

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
  devMode: true,
  audioMode: CODE_DEFAULT_SHORT_AUDIO_MODE,
  smartEditorial: true,
  bookendZoom: true,
  smartReframe: true,
  reframe: { ...STUDIO_SHORT_REFRAME_DEFAULTS },
};

export const SHORT_PIPELINE_SETTINGS_STORAGE_KEY =
  "v2c-short-pipeline-settings-v2";

const LEGACY_PIPELINE_SETTINGS_STORAGE_KEY =
  "v2c-short-pipeline-settings-v1";

/** Bump when stored shape or migration rules change. */
export const PIPELINE_SETTINGS_SCHEMA_VERSION = 3;

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

function parseStoredPipeline(raw: unknown): StudioShortPipelineSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const audio = parseShortAudioMode(
    typeof o.audioMode === "string" ? o.audioMode : undefined
  );
  if (!audio) return null;

  const reframeRaw =
    o.reframe && typeof o.reframe === "object"
      ? (o.reframe as Record<string, unknown>)
      : {};
  const d = STUDIO_SHORT_REFRAME_DEFAULTS;

  return {
    devMode: o.devMode !== false,
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

/** Undo mistaken v1 migration that forced deepfilter/fast → gym. */
function normalizeMigratedAudioMode(mode: ShortAudioMode): ShortAudioMode {
  if (mode === "gym") return CODE_DEFAULT_SHORT_AUDIO_MODE;
  if (mode === "fast") return CODE_DEFAULT_SHORT_AUDIO_MODE;
  return mode;
}

function readStoredSchemaVersion(raw: Record<string, unknown>): number {
  return typeof raw.schemaVersion === "number" && Number.isFinite(raw.schemaVersion)
    ? raw.schemaVersion
    : 0;
}

/** One-time fix for rows saved before schemaVersion (mistaken gym default). */
export function applyLegacyAudioMigration(
  settings: StudioShortPipelineSettings
): StudioShortPipelineSettings {
  return {
    ...settings,
    audioMode: normalizeMigratedAudioMode(settings.audioMode),
  };
}

function loadLegacyV1Settings(): StudioShortPipelineSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_PIPELINE_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseStoredPipeline(JSON.parse(raw));
    if (!parsed) return null;
    return {
      ...parsed,
      audioMode: normalizeMigratedAudioMode(parsed.audioMode),
    };
  } catch {
    return null;
  }
}

export function getStudioShortPipelineSettingsFromStorage(): StudioShortPipelineSettings {
  const fallback = {
    ...STUDIO_SHORT_PIPELINE_DEFAULTS,
    reframe: { ...STUDIO_SHORT_REFRAME_DEFAULTS },
  };
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(SHORT_PIPELINE_SETTINGS_STORAGE_KEY);
    if (raw) {
      const record = JSON.parse(raw) as Record<string, unknown>;
      const parsed = parseStoredPipeline(record);
      if (parsed) {
        const schemaVersion = readStoredSchemaVersion(record);
        if (schemaVersion < PIPELINE_SETTINGS_SCHEMA_VERSION) {
          const migrated = applyLegacyAudioMigration(parsed);
          setStudioShortPipelineSettingsToStorage(migrated);
          return migrated;
        }
        return parsed;
      }
    }
    const legacy = loadLegacyV1Settings();
    if (legacy) {
      setStudioShortPipelineSettingsToStorage(legacy);
      return legacy;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export function setStudioShortPipelineSettingsToStorage(
  settings: StudioShortPipelineSettings
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SHORT_PIPELINE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...settings,
        schemaVersion: PIPELINE_SETTINGS_SCHEMA_VERSION,
      })
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
  const audioMode =
    parseShortAudioMode(partial.audioMode) ?? base.audioMode;
  return {
    devMode:
      typeof partial.devMode === "boolean" ? partial.devMode : base.devMode,
    audioMode,
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

/** Pipeline fields actually sent to Video to Short (dev mode overrides audio). */
export function resolveEffectiveStudioShortPipelineSettings(
  settings: StudioShortPipelineSettings
): StudioShortPipelineSettings {
  if (!settings.devMode) return settings;
  return {
    ...settings,
    audioMode: DEV_MODE_SHORT_AUDIO_MODE,
  };
}
