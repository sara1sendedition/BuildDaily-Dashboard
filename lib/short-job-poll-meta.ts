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

export function pickAudioModeFromJobPoll(state: ShortJobPollLike): string | null {
  return pickString(state, "audio_mode", "audioMode");
}
