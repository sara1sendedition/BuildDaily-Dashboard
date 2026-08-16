"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DriveClipPickerModal } from "@/app/components/DriveClipPickerModal";
import { DismissableHint } from "@/app/components/DismissableHint";
import type { DriveInboxFile } from "@/app/components/DriveInboxPanel";
import { MAX_CAROUSEL_FOCUS_CHARS } from "@/lib/carousel-focus";
import { clientApiPath } from "@/lib/client-api-path";
import { fetchDriveInboxConfigured } from "@/lib/drive-inbox-available";
import {
  clipBytesEstimate,
  clipDetailLine,
  clipDisplayName,
  driveClipsFromInbox,
  resolveClipsToFiles,
  rowDriveIds,
  rowIsAllDrive,
  type ClipEntry,
} from "@/lib/stitch-clips";
import { incrementClipsStitched } from "@/lib/hub/metrics-store";
import { enqueueServerMultiplierJob } from "@/lib/multiplier-queue/processing-jobs-client";
import { autoGroupDriveClips } from "@/lib/run-stitch-auto-group";
import { setShortSourceTool } from "@/lib/short-source-tool";
import {
  recoverStitchJobIdByCorrelationId,
  uploadStitchRow,
  uploadStitchRowFromDrive,
} from "@/lib/run-stitch";
import { uploadFileToBunnyStorage } from "@/lib/storage/bunny-upload-client";
import {
  appendStitchBatchRows,
  clearStitchBatch,
  describeAgeMs,
  generateStitchId,
  hasIncompleteRows,
  patchStitchRow,
  readStitchBatch,
  writeStitchBatch,
  type StitchBatchState,
  type StitchRowState,
} from "@/lib/stitch-batch-state";

/** How many stitch rows to upload/poll at once (mirrors Multiplier’s pool). */
const STITCH_CONCURRENCY = 3;

async function enqueueMultiplierFromStitch(opts: {
  videoLabel: string;
  stitchJobId?: string;
  driveFileId?: string;
  sourceVideoUrl?: string;
  aiInstructions?: string;
  outputsWanted?: { carousel: boolean; photo: boolean; short: boolean };
  destLabel?: string;
}): Promise<void> {
  const destLabel = opts.destLabel ?? "Multiplier";
  const created = await enqueueServerMultiplierJob({
    videoLabel: opts.videoLabel,
    ...(opts.stitchJobId ? { stitchJobId: opts.stitchJobId } : {}),
    ...(opts.driveFileId ? { driveFileId: opts.driveFileId } : {}),
    ...(opts.sourceVideoUrl ? { sourceVideoUrl: opts.sourceVideoUrl } : {}),
    ...(opts.aiInstructions?.trim()
      ? { aiInstructions: opts.aiInstructions.trim() }
      : {}),
    ...(opts.outputsWanted ? { outputsWanted: opts.outputsWanted } : {}),
  });
  if (!created.ok) {
    throw new Error(
      created.message || `Could not queue ${destLabel} on the server.`,
    );
  }
}

async function stitchJobIdAfterUpload(
  correlationId: string,
  upload: () => Promise<{ jobId: string }>,
): Promise<string> {
  try {
    return (await upload()).jobId;
  } catch (e) {
    const recovered = await recoverStitchJobIdByCorrelationId(
      correlationId,
    ).catch(() => null);
    if (!recovered) throw e;
    return recovered;
  }
}

/**
 * Stitch page — concatenates clips on the Video-to-Short backend, then
 * creates a durable Multiplier ProcessingJob (Drive id, stitch job id, or
 * Bunny URL). Hub cron ingest → carousel/photo/short. The laptop can close
 * after enqueue; the stitched MP4 is never downloaded into this browser.
 */

const SHORT_ONLY_OUTPUTS_WANTED = {
  carousel: false,
  photo: false,
  short: true,
} as const;

type RowRunStatus = "idle" | "queued" | "running" | "done" | "failed";

type StitchRow = {
  id: string;
  clips: ClipEntry[];
  aiInstructions: string;
  showAiInstructions: boolean;
  runStatus: RowRunStatus;
  runProgress?: string;
  runError?: string;
  /** Why auto-group put these clips on this row (stitch vs solo). */
  groupReason?: string;
  /** Index into ``stitch:batchState`` while this row is in a Process run. */
  batchRowIndex?: number;
};

type Status = "idle" | "uploading" | "error" | "resuming";

type StitchWorkItem = {
  uiRowId: string;
  batchRowIndex: number;
  correlationId: string;
  outputFilename: string;
  clips: ClipEntry[];
  aiInstructions: string;
  label: string;
};

type RecoveryBannerState = {
  batch: StitchBatchState;
  /** Per-row outcomes after we last checked the server, for the banner copy. */
  rowsNeedingRetry: number[];
  rowsResumable: number[];
};

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm", ".mkv"];

function isProbablyVideo(file: File): boolean {
  const lower = file.name.toLowerCase();
  return (
    file.type.startsWith("video/") ||
    VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function safeRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `clip-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function emptyStitchRow(): StitchRow {
  return {
    id: safeRandomId(),
    clips: [],
    aiInstructions: "",
    showAiInstructions: false,
    runStatus: "idle",
  };
}

export default function StitchPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:py-14">
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
            Stitch
          </h1>
          <p className="text-sm text-stone-600">Loading…</p>
        </main>
      }
    >
      <StitchPageContent />
    </Suspense>
  );
}

function StitchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toEditor = searchParams.get("to") === "editor";
  const destLabel = toEditor ? "Video Editor" : "Multiplier";
  const destPath = toEditor
    ? "/video-editor?fromStitch=1"
    : "/multiplier?fromStitch=1";

  function enqueueHandoff(
    opts: Parameters<typeof enqueueMultiplierFromStitch>[0],
  ): Promise<void> {
    setShortSourceTool(toEditor ? "video-editor" : "multiplier");
    return enqueueMultiplierFromStitch({
      ...opts,
      destLabel,
      ...(toEditor ? { outputsWanted: SHORT_ONLY_OUTPUTS_WANTED } : {}),
    });
  }
  const [rows, setRows] = useState<StitchRow[]>([emptyStitchRow()]);
  const [autoGroupPickerOpen, setAutoGroupPickerOpen] = useState(false);
  const [autoGrouping, setAutoGrouping] = useState(false);
  const [processAfterGroup, setProcessAfterGroup] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [progressMsg, setProgressMsg] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [handedOffCount, setHandedOffCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerRowId, setPickerRowId] = useState<string | null>(null);
  const [driveModalRowId, setDriveModalRowId] = useState<string | null>(null);
  const [driveInboxConfigured, setDriveInboxConfigured] = useState<boolean | null>(
    null,
  );
  const [autoGroupAllowed, setAutoGroupAllowed] = useState(false);
  const [dragOverVideoId, setDragOverVideoId] = useState<string | null>(null);
  const [recoveryBanner, setRecoveryBanner] =
    useState<RecoveryBannerState | null>(null);

  const pendingWorkRef = useRef<StitchWorkItem[]>([]);
  const inFlightRef = useRef(0);
  const handedOffCountRef = useRef(0);
  const failedCountRef = useRef(0);
  const rowsRef = useRef<StitchRow[]>([]);
  rowsRef.current = rows;

  // On mount, check whether a previous stitch batch left in-flight work in
  // localStorage. We only show the recovery banner when at least one row
  // is still non-terminal — a batch where every row is already
  // "completed"/"failed" is just stale, so we clear it and start fresh.
  useEffect(() => {
    const batch = readStitchBatch();
    if (!batch) return;
    if (!hasIncompleteRows(batch)) {
      clearStitchBatch();
      return;
    }
    const resumable: number[] = [];
    const needsRetry: number[] = [];
    for (const r of batch.rows) {
      if (r.status === "completed") continue;
      if (r.status === "failed") needsRetry.push(r.rowIndex);
      else resumable.push(r.rowIndex);
    }
    setRecoveryBanner({
      batch,
      rowsResumable: resumable,
      rowsNeedingRetry: needsRetry,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchDriveInboxConfigured().then((configured) => {
      if (!cancelled) setDriveInboxConfigured(configured);
    });
    void fetch(clientApiPath("/api/stitch/auto-group-access"), {
      cache: "no-store",
    })
      .then((r) => r.json() as Promise<{ allowed?: boolean }>)
      .then((data) => {
        if (!cancelled) setAutoGroupAllowed(Boolean(data.allowed));
      })
      .catch(() => {
        if (!cancelled) setAutoGroupAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function addFilesToRow(rowId: string, files: FileList | File[]): boolean {
    const all = Array.from(files);
    const incoming = all.filter(isProbablyVideo);
    if (!incoming.length) {
      if (all.length > 0) {
        setErrorMsg(
          "No recognized video files were added. Use .mp4, .mov, .webm, or similar.",
        );
      }
      return false;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              clips: [
                ...r.clips,
                ...incoming.map((f) => ({
                  id: safeRandomId(),
                  source: "device" as const,
                  file: f,
                })),
              ],
              runStatus:
                r.runStatus === "done" || r.runStatus === "failed"
                  ? "idle"
                  : r.runStatus,
              runError: undefined,
              runProgress: undefined,
            }
          : r
      )
    );
    return true;
  }

  function addDriveClipsToRow(rowId: string, picks: DriveInboxFile[]): boolean {
    if (!picks.length) return false;
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              clips: [...r.clips, ...driveClipsFromInbox(picks)],
              runStatus:
                r.runStatus === "done" || r.runStatus === "failed"
                  ? "idle"
                  : r.runStatus,
              runError: undefined,
              runProgress: undefined,
            }
          : r
      )
    );
    return true;
  }

  function addRow(): void {
    setRows((prev) => [...prev, emptyStitchRow()]);
  }

  function removeRow(rowId: string): void {
    setDriveModalRowId((id) => (id === rowId ? null : id));
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== rowId);
      return next.length > 0 ? next : [emptyStitchRow()];
    });
  }

  function patchUiRow(
    rowId: string,
    patch: Partial<StitchRow>,
  ): void {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
    );
  }

  function rowIsLocked(row: StitchRow): boolean {
    return row.runStatus === "queued" || row.runStatus === "running";
  }

  function clearRow(rowId: string): void {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              clips: [],
              runStatus: r.runStatus === "failed" ? "idle" : r.runStatus,
              runError: undefined,
              runProgress: undefined,
            }
          : r,
      ),
    );
  }

  function setRowInstructions(rowId: string, value: string): void {
    const v = value.slice(0, MAX_CAROUSEL_FOCUS_CHARS);
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, aiInstructions: v } : r))
    );
  }

  function toggleRowInstructions(rowId: string): void {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, showAiInstructions: !r.showAiInstructions }
          : r
      )
    );
  }

  function removeClip(rowId: string, clipId: string): void {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, clips: r.clips.filter((c) => c.id !== clipId) }
          : r
      )
    );
  }

  function moveClip(rowId: string, clipId: string, dir: -1 | 1): void {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const idx = r.clips.findIndex((c) => c.id === clipId);
        if (idx < 0) return r;
        const next = [...r.clips];
        const target = idx + dir;
        if (target < 0 || target >= next.length) return r;
        const [item] = next.splice(idx, 1);
        next.splice(target, 0, item);
        return { ...r, clips: next };
      })
    );
  }

  function moveRow(rowId: string, dir: -1 | 1): void {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === rowId);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  }

  function stitchedNameFromRow(row: StitchRow, index: number): string {
    const first = row.clips[0];
    const name = first ? clipDisplayName(first) : `row-${index + 1}.mp4`;
    const stem = name.replace(/\.[^/.]+$/i, "").trim() || `row-${index + 1}`;
    return `${stem}_stitched.mp4`;
  }

  function refreshPoolProgress(): void {
    const queued = pendingWorkRef.current.length;
    const running = inFlightRef.current;
    const done = handedOffCountRef.current;
    const failed = failedCountRef.current;
    if (running === 0 && queued === 0) {
      if (done === 0 && failed > 0) {
        setStatus("error");
        setProgressMsg("");
        setErrorMsg(
          failed === 1
            ? "Stitch failed for that video."
            : `All ${failed} videos failed.`,
        );
      } else {
        setStatus("idle");
        const failNote =
          failed > 0
            ? ` ${failed} failed — re-add clips on those rows to retry.`
            : "";
        setProgressMsg(
          done > 0
            ? `${done} stitched video${done === 1 ? "" : "s"} sent to ${destLabel}.${failNote} Keep adding here, or open ${destLabel} to edit.`
            : "",
        );
        if (!hasIncompleteRows(readStitchBatch())) {
          clearStitchBatch();
        }
      }
      return;
    }
    setStatus("uploading");
    setProgressMsg(
      `Stitching ${running} in parallel` +
        (queued > 0 ? ` · ${queued} queued` : "") +
        (done > 0 ? ` · ${done} handed off` : "") +
        (failed > 0 ? ` · ${failed} failed` : "") +
        "…",
    );
  }

  async function runOneStitchWork(item: StitchWorkItem): Promise<void> {
    const { uiRowId, batchRowIndex, correlationId, outputFilename, clips, aiInstructions, label } =
      item;
    const onProgress = (msg: string) => {
      patchUiRow(uiRowId, { runProgress: msg });
      setProgressMsg(`${label}: ${msg}`);
    };

    patchUiRow(uiRowId, {
      runStatus: "running",
      runProgress: "Starting…",
      runError: undefined,
    });

    try {
      const name = outputFilename;
      const notes = aiInstructions.trim() || undefined;

      if (rowIsAllDrive(clips) && clips.length === 1) {
        const driveFileId = rowDriveIds(clips)[0]!;
        onProgress("queueing Drive clip on the server…");
        patchStitchRow(batchRowIndex, { status: "completed" });
        await enqueueHandoff({
          videoLabel: name,
          driveFileId,
          aiInstructions: notes,
        });
      } else if (rowIsAllDrive(clips) && clips.length > 1) {
        patchStitchRow(batchRowIndex, { status: "uploading" });
        onProgress(
          `starting server stitch of ${clips.length} Drive clips (no browser download)…`,
        );
        const jobId = await stitchJobIdAfterUpload(correlationId, () =>
          uploadStitchRowFromDrive(rowDriveIds(clips), correlationId),
        );
        patchStitchRow(batchRowIndex, {
          jobId,
          status: "processing",
        });
        onProgress(`queueing ${destLabel} on the server…`);
        await enqueueHandoff({
          videoLabel: name,
          stitchJobId: jobId,
          aiInstructions: notes,
        });
      } else {
        const resolvedFiles = await resolveClipsToFiles(clips, onProgress);
        if (resolvedFiles.length === 1) {
          onProgress("one clip, uploading source for background processing…");
          const only = resolvedFiles[0]!;
          const label = only.name || outputFilename;
          const bunnyUrl = await uploadFileToBunnyStorage(only, {
            filename: `stitch-src/${correlationId}-${label.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
            contentType: only.type || "video/mp4",
          });
          if (!bunnyUrl) {
            throw new Error(
              "Could not upload the clip to storage. Check your connection and try again.",
            );
          }
          patchStitchRow(batchRowIndex, { status: "completed" });
          await enqueueHandoff({
            videoLabel: label,
            sourceVideoUrl: bunnyUrl,
            aiInstructions: notes,
          });
        } else {
          patchStitchRow(batchRowIndex, { status: "uploading" });
          onProgress(`uploading ${resolvedFiles.length} clips…`);
          const jobId = await stitchJobIdAfterUpload(correlationId, () =>
            uploadStitchRow(resolvedFiles, correlationId),
          );
          patchStitchRow(batchRowIndex, {
            jobId,
            status: "processing",
          });
          onProgress(`queueing ${destLabel} on the server…`);
          await enqueueHandoff({
            videoLabel: name,
            stitchJobId: jobId,
            aiInstructions: notes,
          });
        }
      }

      incrementClipsStitched();
      handedOffCountRef.current += 1;
      setHandedOffCount(handedOffCountRef.current);

      patchUiRow(uiRowId, {
        runStatus: "done",
        runProgress: `Sent to ${destLabel}`,
        clips: [],
        batchRowIndex: undefined,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Stitch failed.";
      patchStitchRow(batchRowIndex, { status: "failed", error: message });
      failedCountRef.current += 1;
      patchUiRow(uiRowId, {
        runStatus: "failed",
        runProgress: undefined,
        runError: message,
      });
    }
  }

  function drainStitchPool(): void {
    while (
      inFlightRef.current < STITCH_CONCURRENCY &&
      pendingWorkRef.current.length > 0
    ) {
      const item = pendingWorkRef.current.shift()!;
      inFlightRef.current += 1;
      refreshPoolProgress();
      void runOneStitchWork(item).finally(() => {
        inFlightRef.current -= 1;
        refreshPoolProgress();
        drainStitchPool();
      });
    }
  }

  function enqueueStitchWork(items: StitchWorkItem[]): void {
    if (items.length === 0) return;
    pendingWorkRef.current.push(...items);
    refreshPoolProgress();
    drainStitchPool();
  }

  async function startStitch(fromRows?: StitchRow[]): Promise<void> {
    setErrorMsg("");
    setRecoveryBanner(null);

    const sourceRows = fromRows ?? rows;
    const claimable = sourceRows.filter(
      (r) =>
        r.clips.length > 0 &&
        (r.runStatus === "idle" || r.runStatus === "failed"),
    );
    if (claimable.length < 1) {
      setErrorMsg("Add at least one video with clips first.");
      return;
    }

    const existing = readStitchBatch();
    const startIndex = existing
      ? Math.max(-1, ...existing.rows.map((r) => r.rowIndex)) + 1
      : 0;

    const newStates: StitchRowState[] = claimable.map((row, i) => {
      const batchRowIndex = startIndex + i;
      return {
        rowIndex: batchRowIndex,
        correlationId: generateStitchId(),
        jobId: null,
        status: "pending" as const,
        aiInstructions: row.aiInstructions.trim() || undefined,
        outputFilename: stitchedNameFromRow(row, batchRowIndex),
        clipNames: row.clips.map((c) => clipDisplayName(c)),
      };
    });

    if (existing) {
      appendStitchBatchRows(newStates);
    } else {
      writeStitchBatch({
        batchId: generateStitchId(),
        createdAt: Date.now(),
        rows: newStates,
      });
    }

    // Fresh wave (pool was idle): reset failure counter for this run’s summary.
    if (inFlightRef.current === 0 && pendingWorkRef.current.length === 0) {
      failedCountRef.current = 0;
    }

    const work: StitchWorkItem[] = claimable.map((row, i) => {
      const state = newStates[i]!;
      // Snapshot clips — UI may clear/edit other idle rows while this runs.
      const clipsSnapshot = [...row.clips];
      patchUiRow(row.id, {
        runStatus: "queued",
        runProgress: "Queued…",
        runError: undefined,
        batchRowIndex: state.rowIndex,
      });
      return {
        uiRowId: row.id,
        batchRowIndex: state.rowIndex,
        correlationId: state.correlationId,
        outputFilename: state.outputFilename,
        clips: clipsSnapshot,
        aiInstructions: row.aiInstructions,
        label: `Video ${state.rowIndex + 1}`,
      };
    });

    setStatus("uploading");
    enqueueStitchWork(work);
  }

  /**
   * Resume a previously-started batch that's still recoverable from
   * localStorage. We don't have the original File objects anymore, but we
   * have correlationIds (and possibly jobIds) for every row, which is
   * enough to look up server-side state and download completed outputs.
   *
   * For rows where the server has no record of the upload (correlationId
   * lookup 404s and no jobId was ever stored), we mark them "needs-retry"
   * and tell the user to re-add their clips.
   */
  async function resumeStitch(batch: StitchBatchState): Promise<void> {
    setErrorMsg("");
    setRecoveryBanner(null);
    setStatus("resuming");
    handedOffCountRef.current = 0;
    failedCountRef.current = 0;
    setHandedOffCount(0);

    const resumable = batch.rows.filter((r) => r.status !== "failed");
    if (resumable.length === 0) {
      setStatus("error");
      setErrorMsg(
        "Nothing in that batch could be recovered. Re-add your clips and try again.",
      );
      return;
    }

    let unrecoverable = 0;
    let recovered = 0;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const idx = cursor++;
        if (idx >= resumable.length) return;
        const row = resumable[idx]!;
        const label = `Video ${row.rowIndex + 1}`;

        let jobId = row.jobId;
        if (!jobId) {
          setProgressMsg(`${label}: looking up server-side job…`);
          jobId = await recoverStitchJobIdByCorrelationId(
            row.correlationId,
          ).catch(() => null);
          if (!jobId) {
            patchStitchRow(row.rowIndex, {
              status: "failed",
              error:
                "Upload did not reach the server. Re-add this video's clips to retry.",
            });
            unrecoverable += 1;
            continue;
          }
          patchStitchRow(row.rowIndex, { jobId });
        }

        setProgressMsg(`${label}: queueing ${destLabel} on the server…`);
        try {
          await enqueueHandoff({
            videoLabel: row.outputFilename,
            stitchJobId: jobId,
            aiInstructions: row.aiInstructions,
          });
        } catch (e) {
          patchStitchRow(row.rowIndex, {
            status: "failed",
            error: e instanceof Error ? e.message : `Could not queue ${destLabel}.`,
          });
          unrecoverable += 1;
          continue;
        }
        patchStitchRow(row.rowIndex, { status: "completed" });
        incrementClipsStitched();
        recovered += 1;
        handedOffCountRef.current = recovered;
        setHandedOffCount(recovered);
      }
    };

    try {
      const pool = Math.min(STITCH_CONCURRENCY, resumable.length);
      await Promise.all(Array.from({ length: pool }, () => worker()));

      if (recovered === 0) {
        setStatus("error");
        setErrorMsg(
          unrecoverable === batch.rows.length
            ? "Nothing in that batch could be recovered. Re-add your clips and try again."
            : "Could not recover those videos. Re-add their clips and try again.",
        );
        return;
      }

      clearStitchBatch();
      setStatus("idle");
      const missingNote =
        unrecoverable > 0
          ? ` ${unrecoverable} could not be recovered — re-add those clips.`
          : "";
      setProgressMsg(
        `Recovered ${recovered} stitched video${recovered === 1 ? "" : "s"} → ${destLabel}.${missingNote}`,
      );
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Resume failed.");
    }
  }

  function discardRecovery(): void {
    clearStitchBatch();
    setRecoveryBanner(null);
  }

  function applyAutoGroupRows(
    groups: Awaited<ReturnType<typeof autoGroupDriveClips>>["groups"],
    filesById: Map<string, DriveInboxFile>,
  ): StitchRow[] {
    const kept = rowsRef.current.filter(
      (r) => rowIsLocked(r) || r.runStatus === "done",
    );
    const grouped: StitchRow[] = [];
    for (const g of groups) {
      const picks = g.fileIds
        .map((id) => filesById.get(id))
        .filter((f): f is DriveInboxFile => Boolean(f));
      if (picks.length === 0) continue;
      grouped.push({
        ...emptyStitchRow(),
        clips: driveClipsFromInbox(picks),
        groupReason: g.reason,
      });
    }
    const next = [...kept, ...grouped];
    return next.length > 0 ? next : [emptyStitchRow()];
  }

  async function runAutoGroup(picks: DriveInboxFile[]): Promise<void> {
    if (autoGrouping || status === "uploading" || status === "resuming") return;
    setErrorMsg("");
    setAutoGrouping(true);
    setProgressMsg("Starting Drive auto-group…");
    try {
      const result = await autoGroupDriveClips(picks, (msg) => {
        setProgressMsg(msg);
      });
      const next = applyAutoGroupRows(result.groups, result.filesById);
      setRows(next);
      const stitchN = result.groups.filter((g) => g.kind === "stitch").length;
      const soloN = result.groups.filter((g) => g.kind === "solo").length;
      const failNote =
        result.transcribeErrors.length > 0
          ? ` ${result.transcribeErrors.length} clip${
              result.transcribeErrors.length === 1 ? "" : "s"
            } had no transcript and were queued solo.`
          : "";
      if (processAfterGroup) {
        setProgressMsg(
          `Grouped ${stitchN} stitch + ${soloN} solo.${failNote} Sending to ${destLabel}…`,
        );
        setAutoGrouping(false);
        await startStitch(next);
        return;
      }
      setProgressMsg(
        `Grouped ${stitchN} stitch video${stitchN === 1 ? "" : "s"} and ${soloN} solo.${failNote} Review the rows, then Process.`,
      );
    } catch (e) {
      setErrorMsg(
        e instanceof Error ? e.message : "Auto-group from Drive failed.",
      );
    } finally {
      setAutoGrouping(false);
    }
  }

  const claimableRows = rows.filter(
    (r) =>
      r.clips.length > 0 &&
      (r.runStatus === "idle" || r.runStatus === "failed"),
  );
  const totalClips = rows.reduce((sum, r) => sum + r.clips.length, 0);
  const totalBytes = rows.reduce(
    (sum, r) => sum + r.clips.reduce((a, c) => a + clipBytesEstimate(c), 0),
    0,
  );
  const poolActive = status === "uploading" || status === "resuming";
  const resumeBusy = status === "resuming";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:py-14">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
          Stitch
        </h1>
        <DismissableHint id="stitch-subtitle">
          <p className="mt-1 text-sm text-stone-600">
            Process up to {STITCH_CONCURRENCY} videos at once. Keep adding while
            others stitch — finished videos go to {destLabel} as they complete.
          </p>
        </DismissableHint>
        {driveInboxConfigured === false ? (
          <p className="mt-1 text-xs text-amber-800">
            Drive is not connected yet.
          </p>
        ) : null}
      </section>

      {recoveryBanner && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">
            We found an unfinished stitch from{" "}
            {describeAgeMs(Date.now() - recoveryBanner.batch.createdAt)}.
          </p>
          <p className="mt-1 text-amber-800">
            {recoveryBanner.rowsResumable.length > 0 ? (
              <>
                {recoveryBanner.rowsResumable.length} video
                {recoveryBanner.rowsResumable.length === 1 ? "" : "s"} can be
                resumed from the server (no re-upload needed).
              </>
            ) : (
              <>No videos can be resumed — see retry note below.</>
            )}
            {recoveryBanner.rowsNeedingRetry.length > 0 && (
              <>
                {" "}
                Videos{" "}
                {recoveryBanner.rowsNeedingRetry.map((i) => i + 1).join(", ")}{" "}
                failed earlier and need their clips re-added.
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={poolActive || recoveryBanner.rowsResumable.length === 0}
              onClick={() => resumeStitch(recoveryBanner.batch)}
              className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Resume from server
            </button>
            <button
              type="button"
              disabled={poolActive}
              onClick={discardRecovery}
              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </section>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,.mov,.mp4,.m4v,.webm,.mkv"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            const target = pickerRowId ?? rows[0]?.id;
            if (target) {
              const row = rows.find((r) => r.id === target);
              if (row && !rowIsLocked(row)) addFilesToRow(target, e.target.files);
            }
          }
          e.target.value = "";
        }}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            {rows.length} video{rows.length === 1 ? "" : "s"} · {totalClips} clip
            {totalClips === 1 ? "" : "s"} · {formatBytes(totalBytes)}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {autoGroupAllowed ? (
              <button
                type="button"
                disabled={poolActive || autoGrouping}
                onClick={() => setAutoGroupPickerOpen(true)}
                className="rounded-md border border-palette-teal bg-palette-pale/40 px-2.5 py-1 text-xs font-medium text-palette-depth hover:bg-palette-pale/70 disabled:opacity-40"
              >
                Auto-group from Drive
              </button>
            ) : null}
            <button
              type="button"
              disabled={autoGrouping}
              onClick={addRow}
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
            >
              + Add video
            </button>
          </div>
        </div>
        {autoGroupAllowed ? (
          <label className="flex items-start gap-2 text-xs text-stone-600">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={processAfterGroup}
              disabled={poolActive || autoGrouping}
              onChange={(e) => setProcessAfterGroup(e.target.checked)}
            />
            <span>
              After auto-group, process stitch and solo rows → {destLabel}
              immediately.
            </span>
          </label>
        ) : null}
        <div className="space-y-3">
          {rows.map((row, rowIdx) => {
            const locked = rowIsLocked(row);
            return (
            <section
              key={row.id}
              onDragOver={(e) => {
                if (locked) return;
                e.preventDefault();
                e.stopPropagation();
                if (dragOverVideoId !== row.id) setDragOverVideoId(row.id);
              }}
              onDragLeave={() => {
                if (dragOverVideoId === row.id) setDragOverVideoId(null);
              }}
              onDrop={(e) => {
                if (locked) return;
                e.preventDefault();
                e.stopPropagation();
                setDragOverVideoId(null);
                if (e.dataTransfer.files?.length) {
                  addFilesToRow(row.id, e.dataTransfer.files);
                }
              }}
              className={`rounded-xl border bg-white p-3 shadow-sm transition-colors ${
                dragOverVideoId === row.id
                  ? "border-palette-teal bg-palette-pale/20"
                  : row.runStatus === "done"
                    ? "border-emerald-200 bg-emerald-50/40"
                    : row.runStatus === "failed"
                      ? "border-rose-200"
                      : locked
                        ? "border-amber-200 bg-amber-50/30"
                        : "border-stone-200"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-stone-800">
                  Video {rowIdx + 1}{" "}
                  <span className="text-xs font-normal text-stone-500">
                    ({row.clips.length} clip{row.clips.length === 1 ? "" : "s"})
                  </span>
                  {row.runStatus === "queued" ? (
                    <span className="ml-2 text-xs font-medium text-amber-700">
                      Queued
                    </span>
                  ) : null}
                  {row.runStatus === "running" ? (
                    <span className="ml-2 text-xs font-medium text-amber-800">
                      Stitching…
                    </span>
                  ) : null}
                  {row.runStatus === "done" ? (
                    <span className="ml-2 text-xs font-medium text-emerald-700">
                      Sent to {destLabel}
                    </span>
                  ) : null}
                  {row.runStatus === "failed" ? (
                    <span className="ml-2 text-xs font-medium text-rose-700">
                      Failed
                    </span>
                  ) : null}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    disabled={locked || autoGrouping}
                    onClick={() => {
                      setPickerRowId(row.id);
                      fileInputRef.current?.click();
                    }}
                    className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-40"
                  >
                    From device
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => setDriveModalRowId(row.id)}
                    className="rounded border border-palette-teal bg-palette-pale/30 px-2 py-1 text-xs font-medium text-palette-depth hover:bg-palette-pale/50 disabled:opacity-40"
                  >
                    Google Drive
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => toggleRowInstructions(row.id)}
                    className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-40"
                  >
                    {row.showAiInstructions ? "Hide AI instructions" : "Add AI instructions"}
                  </button>
                  <button
                    type="button"
                    aria-label="Move video up"
                    disabled={locked || rowIdx === 0}
                    onClick={() => moveRow(row.id, -1)}
                    className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Move video down"
                    disabled={locked || rowIdx === rows.length - 1}
                    onClick={() => moveRow(row.id, 1)}
                    className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label="Clear video"
                    disabled={locked || row.clips.length === 0}
                    onClick={() => clearRow(row.id)}
                    className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    aria-label="Remove video"
                    disabled={locked || rows.length === 1}
                    onClick={() => removeRow(row.id)}
                    className="rounded px-2 py-1 text-stone-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {row.groupReason ? (
                <p className="mb-2 text-xs text-stone-500">
                  {row.clips.length >= 2 ? "Stitch: " : "Solo: "}
                  {row.groupReason}
                </p>
              ) : null}
              {row.runProgress || row.runError ? (
                <p
                  className={`mb-2 text-xs ${
                    row.runError ? "text-rose-700" : "text-stone-600"
                  }`}
                >
                  {row.runError ?? row.runProgress}
                </p>
              ) : null}
              {row.clips.length === 0 ? (
                <p className="text-xs text-stone-500">
                  {row.runStatus === "done"
                    ? "Clips cleared after handoff — add more anytime."
                    : "No clips in this video yet."}
                </p>
              ) : (
                <ol className="space-y-2">
                  {row.clips.map((c, idx) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2"
                    >
                      <span className="w-7 text-center text-xs font-semibold text-stone-500">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-stone-900">
                          {clipDisplayName(c)}
                        </p>
                        <p className="text-xs text-stone-500">{clipDetailLine(c)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Move clip up"
                          disabled={locked || idx === 0}
                          onClick={() => moveClip(row.id, c.id, -1)}
                          className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label="Move clip down"
                          disabled={locked || idx === row.clips.length - 1}
                          onClick={() => moveClip(row.id, c.id, 1)}
                          className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          aria-label="Remove clip"
                          disabled={locked}
                          onClick={() => removeClip(row.id, c.id)}
                          className="rounded px-2 py-1 text-stone-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {row.showAiInstructions ? (
                <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
                  <label className="block text-xs font-medium text-stone-700">
                    AI instructions for this video (optional)
                  </label>
                  <textarea
                    rows={3}
                    maxLength={MAX_CAROUSEL_FOCUS_CHARS}
                    value={row.aiInstructions}
                    disabled={locked}
                    onChange={(e) => setRowInstructions(row.id, e.target.value)}
                    placeholder="Only for this video: hook angle, what to trim/keep, tone, CTA, etc."
                    className="mt-1.5 w-full resize-y rounded-md border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-palette-teal focus:outline-none focus:ring-1 focus:ring-palette-teal disabled:bg-stone-100"
                  />
                  <p className="mt-1 text-[11px] text-stone-500">
                    {row.aiInstructions.length} / {MAX_CAROUSEL_FOCUS_CHARS}
                  </p>
                </div>
              ) : null}
            </section>
            );
          })}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void startStitch()}
          disabled={resumeBusy || autoGrouping || claimableRows.length < 1}
          className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {resumeBusy
            ? "Resuming…"
            : poolActive
              ? `Process ${claimableRows.length} more → ${destLabel}`
              : `Process ${claimableRows.length} video${claimableRows.length === 1 ? "" : "s"} → ${destLabel}`}
        </button>
        {handedOffCount > 0 ? (
          <button
            type="button"
            onClick={() => router.push(destPath)}
            className="rounded-lg border border-emerald-700 bg-white px-5 py-2.5 text-sm font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50"
          >
            Open {destLabel} ({handedOffCount} ready)
          </button>
        ) : null}
      </section>

      {(poolActive || autoGrouping || progressMsg || errorMsg) && (
        <section
          className={`rounded-lg border px-4 py-3 text-sm ${
            errorMsg
              ? "border-rose-200 bg-rose-50 text-rose-900"
              : "border-stone-200 bg-stone-50 text-stone-800"
          }`}
        >
          {errorMsg ? (
            <p>
              <strong>Error:</strong> {errorMsg}
            </p>
          ) : (
            <p>
              {(poolActive || autoGrouping) && (
                <span className="mr-2 inline-block animate-pulse">●</span>
              )}
              {progressMsg}
            </p>
          )}
        </section>
      )}

      <DriveClipPickerModal
        open={driveModalRowId !== null}
        onClose={() => setDriveModalRowId(null)}
        disabled={
          autoGrouping ||
          (!!driveModalRowId &&
            rowIsLocked(
              rows.find((r) => r.id === driveModalRowId) ?? emptyStitchRow(),
            ))
        }
        onAddClips={(picks) => {
          if (!driveModalRowId) return false;
          const row = rows.find((r) => r.id === driveModalRowId);
          if (row && rowIsLocked(row)) return false;
          return addDriveClipsToRow(driveModalRowId, picks);
        }}
      />

      {autoGroupAllowed ? (
        <DriveClipPickerModal
          open={autoGroupPickerOpen}
          variant="auto-group"
          onClose={() => setAutoGroupPickerOpen(false)}
          disabled={autoGrouping || poolActive}
          onAutoGroup={(picks) => {
            void runAutoGroup(picks);
          }}
        />
      ) : null}

    </main>
  );
}
