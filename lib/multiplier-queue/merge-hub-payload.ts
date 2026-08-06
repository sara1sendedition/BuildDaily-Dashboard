import {
  mergeOutputsState,
  type MultiplierOutputsState,
} from "@/lib/multiplier-queue/output-state";

/**
 * Merge a client Hub payload onto the existing server payload.
 * Prevents thin browser upserts from wiping durable fields (bunnyUrls,
 * processingJobId, outputs) that workers wrote.
 *
 * - `null` deletes a top-level key
 * - `outputs` / `bunnyUrls` are deep-merged
 * - Durable ids are preserved when the client omits them
 */
export function mergeHubQueuePayload(
  currentRaw: unknown,
  incomingRaw: unknown,
): Record<string, unknown> {
  const current =
    currentRaw && typeof currentRaw === "object"
      ? ({ ...(currentRaw as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : { v: 1 };
  if (!incomingRaw || typeof incomingRaw !== "object") {
    return current;
  }
  const incoming = incomingRaw as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...current };

  const durableKeys = new Set([
    "processingJobId",
    "shortJobId",
    "driveFileId",
    "shortOutputRevision",
  ]);

  for (const [k, v] of Object.entries(incoming)) {
    if (v === null) {
      // Never let a thin client wipe durable server-owned identifiers.
      if (durableKeys.has(k)) continue;
      delete merged[k];
      continue;
    }
    if (
      k === "outputs" &&
      v &&
      typeof v === "object" &&
      current.outputs &&
      typeof current.outputs === "object"
    ) {
      merged.outputs = mergeOutputsState(
        current.outputs as MultiplierOutputsState,
        v as MultiplierOutputsState,
      );
      continue;
    }
    if (
      k === "bunnyUrls" &&
      v &&
      typeof v === "object" &&
      current.bunnyUrls &&
      typeof current.bunnyUrls === "object"
    ) {
      const nextBunny: Record<string, unknown> = {
        ...(current.bunnyUrls as Record<string, unknown>),
      };
      for (const [bk, bv] of Object.entries(v as Record<string, unknown>)) {
        // Ignore null/empty so thin client upserts cannot erase CDN assets.
        if (bv == null || bv === "") continue;
        nextBunny[bk] = bv;
      }
      merged.bunnyUrls = nextBunny;
      continue;
    }
    merged[k] = v;
  }

  // Preserve durable identifiers when the client simply omitted them.
  for (const key of [
    "processingJobId",
    "shortJobId",
    "driveFileId",
    "shortOutputRevision",
  ] as const) {
    if (
      !(key in incoming) &&
      current[key] != null &&
      (merged[key] == null || merged[key] === "")
    ) {
      merged[key] = current[key];
    }
  }

  return merged;
}

function outputsStillInFlight(payload: Record<string, unknown>): boolean {
  const outputs =
    payload.outputs && typeof payload.outputs === "object"
      ? (payload.outputs as Record<string, { status?: string }>)
      : null;
  if (!outputs) return false;
  return ["carousel", "photo", "short"].some((key) => {
    const status = outputs[key]?.status;
    return (
      status === "pending" ||
      status === "uploading" ||
      status === "queued" ||
      status === "processing"
    );
  });
}

/**
 * Prefer server status when a durable job is still in flight and the client
 * tries to mark the row failed/done with a thin payload.
 */
export function resolveHubQueueStatus(opts: {
  existingStatus: string;
  incomingStatus: string;
  mergedPayload: Record<string, unknown>;
}): string {
  const processingJobId =
    typeof opts.mergedPayload.processingJobId === "string"
      ? opts.mergedPayload.processingJobId.trim()
      : "";
  if (
    opts.existingStatus === "processing" &&
    processingJobId &&
    (opts.incomingStatus === "failed" ||
      (opts.incomingStatus === "done" &&
        outputsStillInFlight(opts.mergedPayload)))
  ) {
    return "processing";
  }
  return opts.incomingStatus;
}
