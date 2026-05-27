/**
 * Audio modes for Video to Short — must match backend ``app/audio_mode.VALID_AUDIO_MODES``.
 * Defaults match ``app/config.py`` (code-based; no Multiplier env required).
 */

export type ShortAudioMode = "original" | "fast" | "deepfilter" | "gym";

export const SHORT_AUDIO_MODES: readonly ShortAudioMode[] = [
  "deepfilter",
  "gym",
  "fast",
  "original",
] as const;

/** Same as Video to Short ``Settings.default_audio_mode`` in code. */
export const CODE_DEFAULT_SHORT_AUDIO_MODE: ShortAudioMode = "deepfilter";

const ALIASES: Record<string, ShortAudioMode> = {
  "deep-filter": "deepfilter",
  deep_filter: "deepfilter",
  gymnasium: "gym",
  loud: "gym",
  music: "gym",
  separate: "gym",
  demucs: "gym",
};

export function parseShortAudioMode(
  raw: string | undefined | null
): ShortAudioMode | null {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return null;
  const mapped = ALIASES[key] ?? key;
  return SHORT_AUDIO_MODES.includes(mapped as ShortAudioMode)
    ? (mapped as ShortAudioMode)
    : null;
}
