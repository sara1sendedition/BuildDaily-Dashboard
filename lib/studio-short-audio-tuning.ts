/**
 * Per-job audio enhancement sliders for Video to Short reprocess/create.
 * Values map to backend form fields in ``app/audio_edit_defaults.py``.
 */

export type StudioShortAudioTuning = {
  /** 0–1 → ``audio_deesser_intensity`` */
  deesserIntensity: number;
  /** 0–1 → ``audio_polish_eq_gain_db`` (0 = off, 1 = strongest cut) */
  harshnessReduction: number;
  /** 0–1 → ``audio_fast_nr`` (FFmpeg afftdn strength) */
  noiseReduction: number;
  /** 0–1 → ``audio_gym_blend_original`` (gym / loud-room mode) */
  gymRoomBlend: number;
};

export const STUDIO_SHORT_AUDIO_TUNING_DEFAULTS: StudioShortAudioTuning = {
  deesserIntensity: 0.32,
  harshnessReduction: 0.375,
  noiseReduction: 2 / 3,
  gymRoomBlend: 0.36,
};

const EQ_GAIN_DB_MIN = -8;
const FAST_NR_MIN = 8;
const FAST_NR_MAX = 32;
const GYM_BLEND_MAX = 0.5;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function harshnessSliderToEqGainDb(slider: number): number {
  return EQ_GAIN_DB_MIN * clamp01(slider);
}

export function eqGainDbToHarshnessSlider(db: number): number {
  if (!Number.isFinite(db) || db >= 0) return 0;
  return clamp01(-db / -EQ_GAIN_DB_MIN);
}

export function noiseSliderToNr(slider: number): number {
  return FAST_NR_MIN + clamp01(slider) * (FAST_NR_MAX - FAST_NR_MIN);
}

export function nrToNoiseSlider(nr: number): number {
  if (!Number.isFinite(nr)) return STUDIO_SHORT_AUDIO_TUNING_DEFAULTS.noiseReduction;
  return clamp01((nr - FAST_NR_MIN) / (FAST_NR_MAX - FAST_NR_MIN));
}

export function gymBlendSliderToOriginal(slider: number): number {
  return clamp01(slider) * GYM_BLEND_MAX;
}

export function gymOriginalToBlendSlider(original: number): number {
  if (!Number.isFinite(original)) return STUDIO_SHORT_AUDIO_TUNING_DEFAULTS.gymRoomBlend;
  return clamp01(original / GYM_BLEND_MAX);
}

export function audioTuningToFormFields(
  tuning: StudioShortAudioTuning
): Record<string, string> {
  return {
    audio_deesser_intensity: String(clamp01(tuning.deesserIntensity)),
    audio_polish_eq_gain_db: String(
      harshnessSliderToEqGainDb(tuning.harshnessReduction)
    ),
    audio_fast_nr: String(noiseSliderToNr(tuning.noiseReduction)),
    audio_gym_blend_original: String(
      gymBlendSliderToOriginal(tuning.gymRoomBlend)
    ),
  };
}

export function parseStudioShortAudioTuning(
  raw: unknown
): StudioShortAudioTuning | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const read = (key: keyof StudioShortAudioTuning): number => {
    const n = Number(o[key]);
    return Number.isFinite(n) ? clamp01(n) : STUDIO_SHORT_AUDIO_TUNING_DEFAULTS[key];
  };
  return {
    deesserIntensity: read("deesserIntensity"),
    harshnessReduction: read("harshnessReduction"),
    noiseReduction: read("noiseReduction"),
    gymRoomBlend: read("gymRoomBlend"),
  };
}

const TUNING_EPS = 0.005;

export function audioTuningEqual(
  a: StudioShortAudioTuning,
  b: StudioShortAudioTuning
): boolean {
  return (
    Math.abs(a.deesserIntensity - b.deesserIntensity) < TUNING_EPS &&
    Math.abs(a.harshnessReduction - b.harshnessReduction) < TUNING_EPS &&
    Math.abs(a.noiseReduction - b.noiseReduction) < TUNING_EPS &&
    Math.abs(a.gymRoomBlend - b.gymRoomBlend) < TUNING_EPS
  );
}

export function resolveStudioShortAudioTuning(
  partial?: Partial<StudioShortAudioTuning> | null
): StudioShortAudioTuning {
  const base = STUDIO_SHORT_AUDIO_TUNING_DEFAULTS;
  if (!partial) return { ...base };
  return {
    deesserIntensity:
      typeof partial.deesserIntensity === "number"
        ? clamp01(partial.deesserIntensity)
        : base.deesserIntensity,
    harshnessReduction:
      typeof partial.harshnessReduction === "number"
        ? clamp01(partial.harshnessReduction)
        : base.harshnessReduction,
    noiseReduction:
      typeof partial.noiseReduction === "number"
        ? clamp01(partial.noiseReduction)
        : base.noiseReduction,
    gymRoomBlend:
      typeof partial.gymRoomBlend === "number"
        ? clamp01(partial.gymRoomBlend)
        : base.gymRoomBlend,
  };
}
