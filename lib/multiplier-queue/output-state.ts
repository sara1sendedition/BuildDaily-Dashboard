/**
 * Per-output processing + ready-to-schedule state for Multiplier queue items.
 * Stored under Hub `MultiplierQueuePayload.outputs`.
 */

export type MultiplierOutputKey = "carousel" | "photo" | "short";

export type OutputProcessStatus =
  | "pending"
  | "uploading"
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "skipped";

export type MultiplierOutputState = {
  status: OutputProcessStatus;
  error?: string;
  attempts?: number;
  readyToSchedule?: boolean;
  progress?: string;
};

export type MultiplierOutputsState = Partial<
  Record<MultiplierOutputKey, MultiplierOutputState>
>;

export const MULTIPLIER_OUTPUT_KEYS: MultiplierOutputKey[] = [
  "carousel",
  "photo",
  "short",
];

export function emptyOutputState(
  status: OutputProcessStatus = "pending",
): MultiplierOutputState {
  return { status, attempts: 0, readyToSchedule: false };
}

export function buildInitialOutputs(wanted: {
  carousel?: boolean;
  photo?: boolean;
  short?: boolean;
}): MultiplierOutputsState {
  const out: MultiplierOutputsState = {};
  if (wanted.carousel) out.carousel = emptyOutputState("queued");
  else out.carousel = emptyOutputState("skipped");
  if (wanted.photo) out.photo = emptyOutputState("queued");
  else out.photo = emptyOutputState("skipped");
  if (wanted.short) out.short = emptyOutputState("queued");
  else out.short = emptyOutputState("skipped");
  return out;
}

export function mergeOutputsState(
  current: MultiplierOutputsState | undefined,
  patch: MultiplierOutputsState | undefined,
): MultiplierOutputsState {
  const base: MultiplierOutputsState = { ...(current ?? {}) };
  if (!patch) return base;
  for (const key of MULTIPLIER_OUTPUT_KEYS) {
    const incoming = patch[key];
    if (!incoming) continue;
    base[key] = { ...(base[key] ?? emptyOutputState()), ...incoming };
  }
  return base;
}

/** Aggregate queue row status from per-output states. */
export function aggregateQueueStatusFromOutputs(
  outputs: MultiplierOutputsState | undefined,
): "processing" | "done" | "failed" {
  if (!outputs) return "processing";
  const active = MULTIPLIER_OUTPUT_KEYS.map((k) => outputs[k]).filter(
    (o): o is MultiplierOutputState =>
      Boolean(o) && o!.status !== "skipped",
  );
  if (active.length === 0) return "done";
  if (
    active.some((o) =>
      ["pending", "uploading", "queued", "processing"].includes(o.status),
    )
  ) {
    return "processing";
  }
  if (active.every((o) => o.status === "failed")) return "failed";
  // Mix of done + failed: row is done only when at least one output succeeded.
  // Failed outputs keep readyToSchedule=false so schedule UI cannot pick them.
  if (active.some((o) => o.status === "done")) return "done";
  return "failed";
}

/** True when a specific output finished successfully and may be scheduled. */
export function outputHasSucceeded(
  outputs: MultiplierOutputsState | undefined,
  key: MultiplierOutputKey,
): boolean {
  return outputs?.[key]?.status === "done";
}

export function outputReadyToSchedule(
  outputs: MultiplierOutputsState | undefined,
  key: MultiplierOutputKey,
): boolean {
  return outputs?.[key]?.readyToSchedule === true;
}

export function anyOutputReadyToSchedule(
  outputs: MultiplierOutputsState | undefined,
): boolean {
  return MULTIPLIER_OUTPUT_KEYS.some((k) => outputReadyToSchedule(outputs, k));
}
