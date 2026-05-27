import { clientApiPath } from "@/lib/client-api-path";
import {
  resolveEffectiveStudioShortPipelineSettings,
  resolveStudioShortPipelineSettings,
  type StudioShortPipelineSettings,
} from "@/lib/studio-short-pipeline-settings";
import {
  pickEditorialDisplayCutsFromJobPoll,
  pickEditorialSkipFromJobPoll,
  pickEditorialSummaryFromJobPoll,
} from "@/lib/short-job-poll-meta";
import { mergeShortEditorialNotes } from "@/lib/video-to-short-proxy-form";
import {
  removalsForReprocess,
  type TimelineRemoval,
} from "@/lib/short-timeline-types";

/**
 * Client-side: submit a video to Video to Short (via Next proxy), poll until complete, return edited MP4 as File.
 *
 * Studio defaults start in dev mode (fast audio). Turn off dev mode under Advanced
 * pipeline for production DeepFilter. Pipeline toggles (`audio_mode`, reframe, bookend)
 * are set from `StudioShortTextOptions.pipeline` (UI + localStorage) — the Next proxy
 * is a pass-through.
 */

const POLL_MS = 1200;
const MAX_WAIT_MS = 45 * 60 * 1000;

export type RunVideoToShortOptions = {
  signal?: AbortSignal;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

/**
 * Persist the most recent in-flight Short job ID so the home page can offer
 * to recover it if the tab is killed (mobile suspend, refresh) before the
 * poll loop finishes. Cleared on terminal completion or failure.
 */
const IN_FLIGHT_LS_KEY = "v2s:lastJobId";
const IN_FLIGHT_TTL_MS = 60 * 60 * 1000; // 60 min — Short pipeline rarely runs longer.

/**
 * Pre-upload correlation id. We persist this to localStorage BEFORE issuing
 * the multipart upload so that if the upload response stream dies (mobile
 * suspend, tab backgrounding mid-fetch) we can still recover the server-side
 * jobId by querying /api/jobs/by-correlation-id/{cid}.
 *
 * Lifecycle:
 *   1. Generate a UUID, persist it.
 *   2. Send it in the upload as `client_correlation_id`.
 *   3. After the upload returns the real jobId, the in-flight jobId record
 *      replaces this on the recovery path; the correlation entry is cleared
 *      on terminal success/failure.
 *   4. On home-page mount, if NO in-flight jobId is stored but a correlation
 *      entry IS, the recovery flow calls /api/jobs/by-correlation-id to
 *      resolve the real jobId, then resumes via the normal in-flight path.
 */
const PRE_UPLOAD_CORRELATION_LS_KEY = "v2s:preUploadCorrelation";

export type PreUploadCorrelation = {
  correlationId: string;
  /** ms-since-epoch when the upload started. */
  createdAt: number;
  /** Original input filename, used to derive the output File name on recovery. */
  sourceName: string;
};

function persistPreUploadCorrelation(record: PreUploadCorrelation): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(PRE_UPLOAD_CORRELATION_LS_KEY, JSON.stringify(record));
  } catch {
    /* quota / disabled — ignore */
  }
}

export function readPreUploadCorrelation(): PreUploadCorrelation | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  let raw: string | null;
  try {
    raw = ls.getItem(PRE_UPLOAD_CORRELATION_LS_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PreUploadCorrelation>;
    if (
      typeof parsed.correlationId !== "string" ||
      typeof parsed.createdAt !== "number" ||
      typeof parsed.sourceName !== "string"
    ) {
      return null;
    }
    if (Date.now() - parsed.createdAt > IN_FLIGHT_TTL_MS) {
      clearPreUploadCorrelation();
      return null;
    }
    return parsed as PreUploadCorrelation;
  } catch {
    return null;
  }
}

export function clearPreUploadCorrelation(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem(PRE_UPLOAD_CORRELATION_LS_KEY);
  } catch {
    /* ignore */
  }
}

/** Cryptographically-strong UUID for the correlation id; falls back to a Math.random
 *  composite if `crypto.randomUUID` isn't available (older browsers or non-HTTPS).
 *  The uniqueness floor is "good enough that two near-simultaneous uploads from the
 *  same browser don't collide" — not security. */
function generateCorrelationId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  // Fallback: timestamp + 64 bits of randomness. ~4e16 combos per millisecond.
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type InFlightShortJob = {
  jobId: string;
  /** ms-since-epoch when the job was created. */
  createdAt: number;
  /** Original input filename, used to derive the output File name on recovery. */
  sourceName: string;
};

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function persistInFlightShortJob(record: InFlightShortJob): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(IN_FLIGHT_LS_KEY, JSON.stringify(record));
  } catch {
    /* quota / disabled — ignore */
  }
}

export function readInFlightShortJob(): InFlightShortJob | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  let raw: string | null;
  try {
    raw = ls.getItem(IN_FLIGHT_LS_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<InFlightShortJob>;
    if (
      typeof parsed.jobId !== "string" ||
      typeof parsed.createdAt !== "number" ||
      typeof parsed.sourceName !== "string"
    ) {
      return null;
    }
    if (Date.now() - parsed.createdAt > IN_FLIGHT_TTL_MS) {
      clearInFlightShortJob();
      return null;
    }
    return parsed as InFlightShortJob;
  } catch {
    return null;
  }
}

export function clearInFlightShortJob(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem(IN_FLIGHT_LS_KEY);
  } catch {
    /* ignore */
  }
}

/** When the user leaves Short “Hook instructions” empty, steer framing for the opening beat. */
const DEFAULT_HOOK_FRAMING_INSTRUCTIONS =
  "For roughly the first 2 seconds, use a noticeably tighter vertical crop/zoom so the speaker's head and active hands dominate the frame (avoid wide waist-up or full-body shots during that beat). After that, framing can relax for the rest of the reel if it reads better.";

export type ShortJobPoll = {
  id: string;
  status: string;
  progress?: string;
  error?: string | null;
  download_url?: string;
  /** Video to Short stores pipeline metadata here (`_job_to_status_dict`). */
  meta?: Record<string, unknown>;
  /** When present on a completed job, confirms the editorial pass ran (Video to Short API). */
  smart_editorial?: boolean;
  editorial_summary?: string | null;
  /** Some deployments expose camelCase editorial fields. */
  editorialSummary?: string | null;
  editorial_cuts?: unknown;
  editorialCuts?: unknown;
  editorial_skip?: string | null;
  editorialSkip?: string | null;
};

function pickEditorialSummaryFromPoll(state: ShortJobPoll): string | null {
  return pickEditorialSummaryFromJobPoll(state as Record<string, unknown>);
}

function pickEditorialSkipFromPoll(state: ShortJobPoll): string | null {
  return pickEditorialSkipFromJobPoll(state as Record<string, unknown>);
}

/** Read editorial fields from a completed job status (top-level or `meta`). */
export function editorialFieldsFromJobPoll(state: ShortJobPoll): {
  editorialSummary: string | null;
  editorialSkip: string | null;
  editorialCuts: unknown;
} {
  return {
    editorialSummary: pickEditorialSummaryFromPoll(state),
    editorialSkip: pickEditorialSkipFromPoll(state),
    editorialCuts: pickEditorialDisplayCutsFromJobPoll(
      state as Record<string, unknown>
    ),
  };
}

/** Text + pipeline fields sent to Video to Short (create or reprocess). */
export type StudioShortTextOptions = {
  hook_instructions?: string;
  hook_overlay_text?: string;
  editorial_notes?: string;
  /** When omitted, code defaults from `studio-short-pipeline-settings` apply. */
  pipeline?: StudioShortPipelineSettings | null;
  /** User-adjusted cuts from the timeline editor (skips LLM when set). */
  timelineRemovals?: TimelineRemoval[];
};

export type VideoToShortRunResult = {
  outputFile: File;
  /** Present when a real Short API job ran; use for `/reprocess`. */
  jobId: string | null;
  /**
   * Human-readable summary of what the editorial pass did, surfaced from the
   * backend's final job state. e.g.:
   *   "Removed 2 regions (≈4.1s total from the original timeline)"
   *   "Review complete. Nothing was removed — no clear pre-roll, retake, repetition…"
   *   "Smart editorial was skipped (no OpenAI API key)"
   * Null when the run did not invoke Video to Short (passthrough mode).
   */
  editorialSummary: string | null;
  /** Reason code if editorial was skipped: "no_openai_api_key" | "llm_error" | "bad_json_shape" | etc. */
  editorialSkip: string | null;
  /** Concrete cut details — array of {start_label, end_label, duration_sec, reason, snippet}. */
  editorialCuts: unknown;
};

export function getShortOutputFileName(originalName: string): string {
  const stem = originalName.replace(/\.[^/.]+$/i, "").trim() || "video";
  const safe = stem.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^\.+/, "");
  return `${safe || "video"}_short.mp4`;
}

/** Same-origin proxy URL for streaming a completed Short job in `<video src>`. */
export function shortJobDownloadApiUrl(jobId: string): string {
  return clientApiPath(
    `/api/video-to-short/jobs/${encodeURIComponent(jobId)}/download`
  );
}

/**
 * Same multipart fields for POST /api/jobs (create) and POST /api/jobs/:id/reprocess.
 * Keep `smart_editorial=true` in sync with the Vite “Smart editorial” path. Final
 * `editorial_notes` / `audio_mode` are merged in the Next proxy (`video-to-short-proxy-form`).
 */
export function appendStudioShortPipelineFormFields(
  fd: FormData,
  text: StudioShortTextOptions
): void {
  const pipe = resolveEffectiveStudioShortPipelineSettings(
    resolveStudioShortPipelineSettings(text.pipeline)
  );
  const hookIn = (text.hook_instructions ?? "").trim();
  fd.append(
    "hook_instructions",
    hookIn || DEFAULT_HOOK_FRAMING_INSTRUCTIONS
  );
  fd.append("hook_overlay_text", text.hook_overlay_text ?? "");
  fd.append("preset", "a");
  fd.append("placement", "upper");
  fd.append("audio_mode", pipe.audioMode);
  fd.append("smart_editorial", pipe.smartEditorial ? "true" : "false");
  fd.append(
    "editorial_notes",
    mergeShortEditorialNotes(text.editorial_notes ?? "")
  );
  fd.append("bookend_zoom", pipe.bookendZoom ? "true" : "false");
  fd.append("smart_reframe", pipe.smartReframe ? "true" : "false");
  const r = pipe.reframe;
  fd.append("reframe_sample_interval_sec", String(r.sample_interval_sec));
  fd.append("reframe_ema_alpha", String(r.ema_alpha));
  fd.append("reframe_pad_hook", String(r.pad_hook));
  fd.append("reframe_pad_body", String(r.pad_body));
  fd.append("reframe_min_crop_width_frac", String(r.min_crop_width_frac));
  fd.append("reframe_max_crop_width_frac", String(r.max_crop_width_frac));
  fd.append("reframe_max_center_shift_frac", String(r.max_center_shift_frac));
  fd.append("reframe_max_size_step_frac", String(r.max_size_step_frac));
}

function buildCreateJobsFormData(
  video: File,
  text: StudioShortTextOptions
): FormData {
  const fd = new FormData();
  appendStudioShortPipelineFormFields(fd, text);
  fd.append("file", video, video.name);
  return fd;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Next returns HTML for unknown routes; JSON callers should not surface megabytes of markup. */
function sameOriginApiFailureMessage(
  status: number,
  body: string,
  what: string
): string {
  const t = body.trim();
  const html404 =
    status === 404 &&
    (t.startsWith("<!DOCTYPE") ||
      t.startsWith("<html") ||
      t.includes("404: This page could not be found"));
  if (html404) {
    return `${what} (${status}): got a Next.js HTML 404 instead of JSON—often \`/api/...\` missed the app's basePath. Set NEXT_PUBLIC_BASE_PATH to your mount path (e.g. /my-app) and rebuild; \`next.config.ts\` picks it up automatically. Or redeploy if this host never had /api/video-to-short routes.`;
  }
  return t || `${what} (${status}).`;
}

export async function fetchJobPollState(
  jobId: string,
  onProgress?: (message: string) => void,
  signal?: AbortSignal
): Promise<ShortJobPoll> {
  throwIfAborted(signal);
  const pollRes = await fetch(
    clientApiPath(`/api/video-to-short/jobs/${encodeURIComponent(jobId)}`),
    { cache: "no-store", signal }
  );
  const pollText = await pollRes.text();
  if (!pollRes.ok) {
    throw new Error(
      sameOriginApiFailureMessage(
        pollRes.status,
        pollText,
        "Job status request failed"
      )
    );
  }

  let state: ShortJobPoll;
  try {
    state = JSON.parse(pollText) as ShortJobPoll;
  } catch {
    throw new Error("Invalid job status JSON from Video to Short.");
  }

  if (typeof state.progress === "string" && state.progress) {
    onProgress?.(state.progress);
  }

  return state;
}

/**
 * After POST /reprocess, many backends still report `completed` until the new run
 * is queued. If we download on the first `completed`, we often get the *previous* MP4.
 * Wait until status is no longer `completed` (e.g. `processing`) before polling for completion.
 */
async function waitForReprocessKickoff(
  jobId: string,
  onProgress?: (message: string) => void
): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (Date.now() > deadline) {
      return;
    }

    const state = await fetchJobPollState(jobId, onProgress);

    if (state.status === "failed") {
      const em =
        typeof state.error === "string" && state.error.trim()
          ? state.error.trim()
          : "Video to Short job failed.";
      throw new Error(em);
    }

    if (state.status !== "completed") {
      return;
    }

    await sleep(POLL_MS);
  }
}

export type ShortPollResult = {
  file: File;
  /** Final job state from the last poll — exposes editorial_summary / cuts / skip. */
  finalState: ShortJobPoll;
};

export async function pollVideoToShortJobUntilFile(
  jobId: string,
  outputFileName: string,
  onProgress?: (message: string) => void,
  signal?: AbortSignal
): Promise<ShortPollResult> {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    throwIfAborted(signal);
    if (Date.now() > deadline) {
      throw new Error(
        "Video to Short timed out after 45 minutes. Check the Short backend logs."
      );
    }

    await sleep(POLL_MS);
    throwIfAborted(signal);

    const state = await fetchJobPollState(jobId, onProgress, signal);

    if (state.status === "failed") {
      const em =
        typeof state.error === "string" && state.error.trim()
          ? state.error.trim()
          : "Video to Short job failed.";
      throw new Error(em);
    }

    if (state.status === "completed") {
      const bust = `_=${Date.now()}`;
      const dlRes = await fetch(
        clientApiPath(
          `/api/video-to-short/jobs/${encodeURIComponent(jobId)}/download?${bust}`
        ),
        { cache: "no-store", signal }
      );
      if (!dlRes.ok) {
        const t = await dlRes.text();
        throw new Error(
          sameOriginApiFailureMessage(
            dlRes.status,
            t,
            "Short download failed"
          )
        );
      }
      const blob = await dlRes.blob();
      const file = new File([blob], outputFileName, {
        type: "video/mp4",
      });
      return { file, finalState: state };
    }
  }
}

/** Download the MP4 when the job is already `completed` (Hub refresh / rehydrate). */
export async function downloadCompletedShortFile(
  jobId: string,
  outputFileName: string,
  signal?: AbortSignal
): Promise<File> {
  throwIfAborted(signal);
  const state = await fetchJobPollState(jobId, undefined, signal);
  if (state.status === "failed") {
    const em =
      typeof state.error === "string" && state.error.trim()
        ? state.error.trim()
        : "Video to Short job failed.";
    throw new Error(em);
  }
  if (state.status !== "completed") {
    throw new Error(
      `Short is still ${state.status}. Keep this tab open or use the recovery banner when it finishes.`
    );
  }
  const bust = `_=${Date.now()}`;
  const dlRes = await fetch(
    clientApiPath(
      `/api/video-to-short/jobs/${encodeURIComponent(jobId)}/download?${bust}`
    ),
    { cache: "no-store", signal }
  );
  if (!dlRes.ok) {
    const t = await dlRes.text();
    throw new Error(
      sameOriginApiFailureMessage(dlRes.status, t, "Short download failed")
    );
  }
  const blob = await dlRes.blob();
  return new File([blob], outputFileName, { type: "video/mp4" });
}

/**
 * Re-run Short on the server-stored original upload (no re-upload). Same pipeline flags as create.
 */
export async function reprocessVideoToShortJob(
  jobId: string,
  text: StudioShortTextOptions,
  outputFileName: string,
  onProgress?: (message: string) => void
): Promise<VideoToShortRunResult> {
  const fd = new FormData();
  // Timeline overrides are applied inside the smart-editorial path on the Short backend.
  const effectiveText: StudioShortTextOptions =
    text.timelineRemovals !== undefined
      ? {
          ...text,
          pipeline: {
            ...resolveStudioShortPipelineSettings(text.pipeline),
            smartEditorial: true,
          },
        }
      : text;
  appendStudioShortPipelineFormFields(fd, effectiveText);
  if (text.timelineRemovals !== undefined) {
    fd.append(
      "timeline_removals_json",
      removalsForReprocess(text.timelineRemovals)
    );
  }

  const res = await fetch(
    clientApiPath(
      `/api/video-to-short/jobs/${encodeURIComponent(jobId)}/reprocess`
    ),
    { method: "POST", body: fd }
  );
  const resText = await res.text();
  if (!res.ok) {
    let err = sameOriginApiFailureMessage(
      res.status,
      resText,
      "Re-process failed"
    );
    try {
      const j = JSON.parse(resText) as { detail?: string; error?: string };
      if (typeof j.detail === "string" && j.detail.trim()) err = j.detail.trim();
      else if (typeof j.error === "string" && j.error.trim()) err = j.error.trim();
    } catch {
      /* keep err (includes HTML-404 hint when applicable) */
    }
    throw new Error(err);
  }

  await waitForReprocessKickoff(jobId, onProgress);
  const { file, finalState } = await pollVideoToShortJobUntilFile(
    jobId,
    outputFileName,
    onProgress
  );
  return {
    outputFile: file,
    jobId,
    ...editorialFieldsFromJobPoll(finalState),
  };
}

/**
 * Runs Video to Short when integration is enabled on the server.
 * If `NEXT_PUBLIC_SKIP_VIDEO_TO_SHORT=1`, returns the input file unchanged and `jobId: null`.
 * If the server responds with integration disabled (503 + disabled), returns the input file and `jobId: null`.
 */
export async function runVideoToShortIfEnabled(
  video: File,
  onProgress?: (message: string) => void,
  text: StudioShortTextOptions = {},
  opts?: RunVideoToShortOptions
): Promise<VideoToShortRunResult> {
  const signal = opts?.signal;
  // Skip / disabled paths return the input unchanged and explicit nulls so the
  // queue item doesn't display a stale "editorial summary" from a prior run.
  const passthroughResult: VideoToShortRunResult = {
    outputFile: video,
    jobId: null,
    editorialSummary: null,
    editorialSkip: null,
    editorialCuts: null,
  };
  if (process.env.NEXT_PUBLIC_SKIP_VIDEO_TO_SHORT === "1") {
    return passthroughResult;
  }

  // Persist a correlation id BEFORE the upload starts. If the upload response
  // stream dies (tab backgrounded mid-fetch, mobile suspend during multipart)
  // the home page will use this on next visit to look up the assigned jobId
  // via /api/jobs/by-correlation-id and resume — no re-upload needed.
  const correlationId = generateCorrelationId();
  persistPreUploadCorrelation({
    correlationId,
    createdAt: Date.now(),
    sourceName: video.name,
  });

  const fd = buildCreateJobsFormData(video, text);
  fd.append("client_correlation_id", correlationId);
  throwIfAborted(signal);
  const createRes = await fetch(clientApiPath("/api/video-to-short/jobs"), {
    method: "POST",
    body: fd,
    signal,
  });

  const createText = await createRes.text();
  if (createRes.status === 503) {
    try {
      const j = JSON.parse(createText) as { disabled?: boolean };
      if (j.disabled === true) {
        clearPreUploadCorrelation();
        return passthroughResult;
      }
    } catch {
      /* fall through */
    }
  }

  if (!createRes.ok) {
    clearPreUploadCorrelation();
    let err = sameOriginApiFailureMessage(
      createRes.status,
      createText,
      "Video to Short create failed"
    );
    try {
      const j = JSON.parse(createText) as { error?: string };
      if (typeof j.error === "string" && j.error.trim()) err = j.error.trim();
    } catch {
      /* keep err */
    }
    throw new Error(err);
  }

  let jobId: string;
  try {
    const j = JSON.parse(createText) as { id?: string };
    if (typeof j.id !== "string" || !j.id) throw new Error("No job id");
    jobId = j.id;
  } catch {
    clearPreUploadCorrelation();
    throw new Error("Invalid response from Video to Short (no job id).");
  }

  // Persist BEFORE the poll loop. If the tab dies during polling (mobile
  // suspend, navigation, refresh) the home page can offer to recover this
  // job from the recovery banner instead of forcing a full re-upload.
  persistInFlightShortJob({
    jobId,
    createdAt: Date.now(),
    sourceName: video.name,
  });
  // We have a real jobId now; the pre-upload correlation entry is no longer
  // useful — clear it so an orphaned-correlation-recovery doesn't fire.
  clearPreUploadCorrelation();

  try {
    const { file, finalState } = await pollVideoToShortJobUntilFile(
      jobId,
      getShortOutputFileName(video.name),
      onProgress,
      signal
    );
    clearInFlightShortJob();
    return {
      outputFile: file,
      jobId,
      ...editorialFieldsFromJobPoll(finalState),
    };
  } catch (err) {
    // Keep in-flight record when a jobId was persisted so the recovery banner can
    // resume polling/download after a mobile tab suspend or network blip.
    throw err;
  }
}

/**
 * Resolve a server-side jobId from a pre-upload correlation id. Used by the
 * home page recovery flow when the upload response was lost — we have the
 * correlation id from localStorage but no jobId. Server returns the matching
 * job's full state (including its real ``id``); 404 means no job was ever
 * created for that correlation (e.g. upload died before reaching the
 * backend, or it's beyond TTL).
 */
export async function lookupShortJobByCorrelationId(
  correlationId: string
): Promise<{ jobId: string; status: string } | null> {
  const res = await fetch(
    clientApiPath(
      `/api/video-to-short/jobs/by-correlation-id/${encodeURIComponent(correlationId)}`
    ),
    { cache: "no-store" }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text();
    throw new Error(
      sameOriginApiFailureMessage(
        res.status,
        t,
        "Correlation lookup failed"
      )
    );
  }
  const j = (await res.json()) as { id?: string; status?: string };
  if (typeof j.id !== "string" || !j.id) return null;
  return { jobId: j.id, status: typeof j.status === "string" ? j.status : "" };
}

/**
 * Resume a previously-persisted Short job by ID. Used by the home page
 * recovery banner. Re-uses the same poll/download path as a fresh create.
 */
export async function recoverInFlightShortJob(
  record: InFlightShortJob,
  onProgress?: (message: string) => void
): Promise<File> {
  try {
    const { file } = await pollVideoToShortJobUntilFile(
      record.jobId,
      getShortOutputFileName(record.sourceName),
      onProgress
    );
    clearInFlightShortJob();
    return file;
  } catch (err) {
    throw err;
  }
}
