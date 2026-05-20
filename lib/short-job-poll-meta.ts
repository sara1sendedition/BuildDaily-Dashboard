/**
 * Video to Short `GET /api/jobs/:id` puts editorial + audio fields on `job.meta`
 * (see Video to Short `app/main.py` `_job_to_status_dict`). This module reads
 * top-level and nested `meta` so studio UI and queue state stay in sync.
 */

export type ShortJobPollLike = Record<string, unknown>;

function metaBag(state: ShortJobPollLike): ShortJobPollLike {
  const raw = state.meta;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as ShortJobPollLike;
  }
  return {};
}

function pickString(state: ShortJobPollLike, ...keys: string[]): string | null {
  const bags = [state, metaBag(state)];
  for (const key of keys) {
    for (const bag of bags) {
      const v = bag[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

function pickDefined(state: ShortJobPollLike, ...keys: string[]): unknown {
  const bags = [state, metaBag(state)];
  for (const key of keys) {
    for (const bag of bags) {
      if (bag[key] !== undefined && bag[key] !== null) return bag[key];
    }
  }
  return null;
}

export function pickEditorialSummaryFromJobPoll(
  state: ShortJobPollLike
): string | null {
  return pickString(state, "editorial_summary", "editorialSummary");
}

export function pickEditorialSkipFromJobPoll(
  state: ShortJobPollLike
): string | null {
  return pickString(state, "editorial_skip", "editorialSkip");
}

export function pickEditorialCutsFromJobPoll(state: ShortJobPollLike): unknown {
  return pickDefined(state, "editorial_cuts", "editorialCuts");
}

function cutsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  return [];
}

/**
 * Cuts for the studio accordion — prefers `meta.timeline.removals` (post–timeline
 * editor) so the list matches Advanced; otherwise merges editorial + dialogue cuts.
 */
export function pickEditorialDisplayCutsFromJobPoll(
  state: ShortJobPollLike
): unknown {
  const meta = metaBag(state);
  const timeline = meta.timeline;
  if (timeline && typeof timeline === "object" && !Array.isArray(timeline)) {
    const removals = (timeline as { removals?: unknown }).removals;
    if (Array.isArray(removals) && removals.length > 0) {
      return removals
        .filter((r) => r && typeof r === "object" && !Array.isArray(r))
        .map((r) => {
          const item = r as Record<string, unknown>;
          const kind = String(item.kind || "editorial");
          const baseReason =
            typeof item.reason === "string" && item.reason.trim()
              ? item.reason.trim()
              : kind === "dialogue"
                ? "Non-dialogue trim"
                : "Editorial cut";
          return {
            start_sec: item.start_sec,
            end_sec: item.end_sec,
            duration_sec: item.duration_sec,
            reason:
              kind === "dialogue" && !baseReason.toLowerCase().includes("dialogue")
                ? `${baseReason} (dialogue trim)`
                : baseReason,
            snippet: item.snippet ?? "",
          };
        });
    }
  }

  const editorial = cutsArray(
    pickDefined(state, "editorial_cuts", "editorialCuts")
  );
  const dialogue = cutsArray(
    pickDefined(state, "dialogue_trim_cuts", "dialogueTrimCuts")
  );
  if (dialogue.length === 0) {
    return editorial.length > 0 ? editorial : null;
  }
  const merged = [
    ...editorial,
    ...dialogue.map((d) => {
      if (!d || typeof d !== "object" || Array.isArray(d)) return d;
      const item = d as Record<string, unknown>;
      const reason =
        typeof item.reason === "string" && item.reason.trim()
          ? item.reason.trim()
          : "Non-dialogue trim";
      return {
        ...item,
        reason: reason.toLowerCase().includes("dialogue")
          ? reason
          : `${reason} (dialogue trim)`,
      };
    }),
  ];
  return merged.length > 0 ? merged : null;
}

export function pickAudioModeFromJobPoll(state: ShortJobPollLike): string | null {
  return pickString(state, "audio_mode", "audioMode");
}
