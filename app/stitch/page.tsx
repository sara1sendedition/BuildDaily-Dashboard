"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DriveClipPickerModal } from "@/app/components/DriveClipPickerModal";
import { MAX_CAROUSEL_FOCUS_CHARS } from "@/lib/carousel-focus";
import { fetchDriveInboxConfigured } from "@/lib/drive-inbox-available";
import { stashStitchedFiles } from "@/lib/stitch-handoff";
import { incrementClipsStitched } from "@/lib/hub/metrics-store";
import {
  downloadStitchOutput,
  pollStitchJobUntilDone,
  recoverStitchJobIdByCorrelationId,
  runStitchRow,
} from "@/lib/run-stitch";
import {
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

/**
 * Stitch page — accepts N video clips (e.g. a shoot recorded in multiple
 * takes), concatenates them in order on the backend, then hands the
 * resulting MP4 to the home page's normal upload flow. The home page
 * runs the parallel Short + Carousel + Image-Post + X/Threads pipeline,
 * so one click here gives all five outputs.
 *
 * Why "stitch only" + handoff instead of running the full pipeline here:
 *   - Home page already has the full parallel orchestration. Reusing it
 *     avoids duplicating Short generation work.
 *   - Studio run notes the user types here are written to the SAME
 *     localStorage key the home page reads, so they carry over
 *     automatically.
 *
 * Resilience model (May 2026 rewrite):
 *   - The backend stitch endpoint is now async-job based. Per-row state
 *     (correlationId + jobId + status) is persisted to localStorage in
 *     ``stitch:batchState`` BEFORE each upload starts. If the laptop
 *     closes mid-stitch (or the tab crashes), the server keeps stitching
 *     and the recovery banner on next mount lets the user resume — the
 *     output is still server-side, identified by jobId.
 */

type ClipEntry = {
  id: string;
  file: File;
};

type StitchRow = {
  id: string;
  clips: ClipEntry[];
  aiInstructions: string;
  showAiInstructions: boolean;
};

type Status = "idle" | "uploading" | "redirecting" | "error" | "resuming";

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

export default function StitchPage() {
  const router = useRouter();
  const [rows, setRows] = useState<StitchRow[]>([
    { id: safeRandomId(), clips: [], aiInstructions: "", showAiInstructions: false },
  ]);
  const [status, setStatus] = useState<Status>("idle");
  const [progressMsg, setProgressMsg] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerRowId, setPickerRowId] = useState<string | null>(null);
  const [driveModalRowId, setDriveModalRowId] = useState<string | null>(null);
  const [driveInboxConfigured, setDriveInboxConfigured] = useState<boolean | null>(
    null,
  );
  const [dragOverVideoId, setDragOverVideoId] = useState<string | null>(null);
  const [recoveryBanner, setRecoveryBanner] =
    useState<RecoveryBannerState | null>(null);

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
              clips: [...r.clips, ...incoming.map((f) => ({ id: safeRandomId(), file: f }))],
            }
          : r
      )
    );
    return true;
  }

  function addRow(): void {
    setRows((prev) => [
      ...prev,
      { id: safeRandomId(), clips: [], aiInstructions: "", showAiInstructions: false },
    ]);
  }

  function removeRow(rowId: string): void {
    setDriveModalRowId((id) => (id === rowId ? null : id));
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== rowId);
      return next.length > 0
        ? next
        : [{ id: safeRandomId(), clips: [], aiInstructions: "", showAiInstructions: false }];
    });
  }

  function clearRow(rowId: string): void {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, clips: [] } : r))
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
    const first = row.clips[0]?.file.name ?? `row-${index + 1}.mp4`;
    const stem = first.replace(/\.[^/.]+$/i, "").trim() || `row-${index + 1}`;
    return `${stem}_stitched.mp4`;
  }

  async function startStitch(): Promise<void> {
    setErrorMsg("");
    setRecoveryBanner(null);
    const nonEmptyRows = rows.filter((r) => r.clips.length > 0);
    if (nonEmptyRows.length < 1) {
      setErrorMsg("Add at least one video with clips first.");
      return;
    }
    setStatus("uploading");

    // Build the initial localStorage batch snapshot BEFORE any upload starts.
    // The correlation IDs in this snapshot are what lets us recover the
    // server-side jobIds if the lid closes after upload-bytes-land but
    // before the response reaches us.
    const batchId = generateStitchId();
    const initialRows: StitchRowState[] = nonEmptyRows.map((row, i) => ({
      rowIndex: i,
      correlationId: generateStitchId(),
      jobId: null,
      status: "pending",
      aiInstructions: row.aiInstructions.trim() || undefined,
      outputFilename: stitchedNameFromRow(row, i),
      clipNames: row.clips.map((c) => c.file.name),
    }));
    const batchState: StitchBatchState = {
      batchId,
      createdAt: Date.now(),
      rows: initialRows,
    };
    writeStitchBatch(batchState);

    const handoffFiles: Array<{
      blob: Blob;
      name: string;
      aiInstructions?: string;
    }> = [];

    try {
      for (let i = 0; i < nonEmptyRows.length; i++) {
        const row = nonEmptyRows[i];
        const rowState = initialRows[i];
        const label = `Video ${i + 1} of ${nonEmptyRows.length}`;

        if (row.clips.length === 1) {
          // Single-clip rows skip the server round-trip entirely — the
          // home page can ingest the original file directly. Mark the row
          // "completed" in localStorage so the resume banner is accurate.
          setProgressMsg(`${label}: one clip, skipping stitch…`);
          const only = row.clips[0].file;
          handoffFiles.push({
            blob: only,
            name: only.name || stitchedNameFromRow(row, i),
            aiInstructions: row.aiInstructions.trim() || undefined,
          });
          patchStitchRow(i, { status: "completed" });
          continue;
        }

        patchStitchRow(i, { status: "uploading" });
        setProgressMsg(`${label}: uploading ${row.clips.length} clips…`);

        const { jobId, blob } = await runStitchRow(
          row.clips.map((c) => c.file),
          rowState.correlationId,
          (msg) => setProgressMsg(`${label}: ${msg}`),
          (jid) => {
            // First moment we know the server-side jobId — persist it
            // immediately so a tab crash after this point is recoverable
            // via the jobId path (cheaper than correlation-id lookup).
            patchStitchRow(i, { jobId: jid, status: "processing" });
          }
        );
        patchStitchRow(i, { jobId, status: "completed" });

        handoffFiles.push({
          blob,
          name: rowState.outputFilename,
          aiInstructions: row.aiInstructions.trim() || undefined,
        });
      }

      setStatus("redirecting");
      setProgressMsg("All videos stitched. Handing off to home queue…");
      await stashStitchedFiles(handoffFiles);
      incrementClipsStitched();
      clearStitchBatch();
      router.push("/multiplier?fromStitch=1");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Bulk video stitch failed.");
      // Leave the batch state in localStorage so the user can refresh and
      // resume from the recovery banner — the server may still finish the
      // in-flight row even though our fetch chain bailed.
    }
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

    const handoffFiles: Array<{
      blob: Blob;
      name: string;
      aiInstructions?: string;
    }> = [];
    const unrecoverable: number[] = [];

    try {
      for (let i = 0; i < batch.rows.length; i++) {
        const row = batch.rows[i];
        const label = `Video ${row.rowIndex + 1}`;

        if (row.status === "failed") {
          // Already terminal-failed — don't retry on resume; the user has
          // to explicitly re-add clips.
          unrecoverable.push(row.rowIndex);
          continue;
        }

        // Resolve a working jobId. Prefer the stored one; fall back to
        // correlation-id lookup. If both fail, the upload never reached
        // the server and this row needs manual retry.
        let jobId = row.jobId;
        if (!jobId) {
          setProgressMsg(`${label}: looking up server-side job…`);
          jobId = await recoverStitchJobIdByCorrelationId(
            row.correlationId
          ).catch(() => null);
          if (!jobId) {
            patchStitchRow(row.rowIndex, {
              status: "failed",
              error:
                "Upload did not reach the server. Re-add this video's clips to retry.",
            });
            unrecoverable.push(row.rowIndex);
            continue;
          }
          patchStitchRow(row.rowIndex, { jobId });
        }

        setProgressMsg(`${label}: checking server status…`);
        try {
          await pollStitchJobUntilDone(jobId, (msg) =>
            setProgressMsg(`${label}: ${msg}`)
          );
        } catch (e) {
          patchStitchRow(row.rowIndex, {
            status: "failed",
            error:
              e instanceof Error ? e.message : "Stitch failed on the server.",
          });
          unrecoverable.push(row.rowIndex);
          continue;
        }

        setProgressMsg(`${label}: downloading stitched video…`);
        let blob: Blob;
        try {
          blob = await downloadStitchOutput(jobId);
        } catch (e) {
          patchStitchRow(row.rowIndex, {
            status: "failed",
            error: e instanceof Error ? e.message : "Download failed.",
          });
          unrecoverable.push(row.rowIndex);
          continue;
        }
        patchStitchRow(row.rowIndex, { status: "completed" });

        handoffFiles.push({
          blob,
          name: row.outputFilename,
          aiInstructions: row.aiInstructions,
        });
      }

      if (handoffFiles.length === 0) {
        setStatus("error");
        setErrorMsg(
          unrecoverable.length === batch.rows.length
            ? "Nothing in that batch could be recovered. Re-add your clips and try again."
            : `Could not recover Videos ${unrecoverable.map((i) => i + 1).join(", ")}. Re-add their clips and try again.`
        );
        return;
      }

      setStatus("redirecting");
      const recoveredCount = handoffFiles.length;
      const missingNote =
        unrecoverable.length > 0
          ? ` (Skipped Videos ${unrecoverable.map((i) => i + 1).join(", ")} — re-add their clips on the home page.)`
          : "";
      setProgressMsg(
        `Recovered ${recoveredCount} stitched video${recoveredCount === 1 ? "" : "s"}. Handing off to home queue…${missingNote}`
      );
      await stashStitchedFiles(handoffFiles);
      incrementClipsStitched();
      clearStitchBatch();
      router.push("/multiplier?fromStitch=1");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Resume failed.");
    }
  }

  function discardRecovery(): void {
    clearStitchBatch();
    setRecoveryBanner(null);
  }

  const nonEmptyRows = rows.filter((r) => r.clips.length > 0);
  const totalClips = rows.reduce((sum, r) => sum + r.clips.length, 0);
  const totalBytes = rows.reduce(
    (sum, r) => sum + r.clips.reduce((a, c) => a + c.file.size, 0),
    0
  );
  const busy =
    status === "uploading" ||
    status === "redirecting" ||
    status === "resuming";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:py-14">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
          Stitch
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Add clips per video from your <strong>device</strong> or{" "}
          <strong>Google Drive</strong> inbox, then process when ready.
        </p>
        {driveInboxConfigured === false ? (
          <p className="mt-1 text-xs text-amber-800">
            Google Drive inbox is not configured on the Video to Short backend
            yet — the Drive button will explain what to set in Coolify.
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
              disabled={busy || recoveryBanner.rowsResumable.length === 0}
              onClick={() => resumeStitch(recoveryBanner.batch)}
              className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Resume from server
            </button>
            <button
              type="button"
              disabled={busy}
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
            if (target) addFilesToRow(target, e.target.files);
          }
          e.target.value = "";
        }}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            {rows.length} video{rows.length === 1 ? "" : "s"} · {totalClips} clip
            {totalClips === 1 ? "" : "s"} · {formatBytes(totalBytes)}
          </h2>
          {!busy && (
            <button
              type="button"
              onClick={addRow}
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
            >
              + Add video
            </button>
          )}
        </div>
        <div className="space-y-3">
          {rows.map((row, rowIdx) => (
            <section
              key={row.id}
              onDragOver={(e) => {
                if (busy) return;
                e.preventDefault();
                e.stopPropagation();
                if (dragOverVideoId !== row.id) setDragOverVideoId(row.id);
              }}
              onDragLeave={() => {
                if (dragOverVideoId === row.id) setDragOverVideoId(null);
              }}
              onDrop={(e) => {
                if (busy) return;
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
                  : "border-stone-200"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-stone-800">
                  Video {rowIdx + 1}{" "}
                  <span className="text-xs font-normal text-stone-500">
                    ({row.clips.length} clip{row.clips.length === 1 ? "" : "s"})
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
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
                    disabled={busy}
                    onClick={() => setDriveModalRowId(row.id)}
                    className="rounded border border-palette-teal bg-palette-pale/30 px-2 py-1 text-xs font-medium text-palette-depth hover:bg-palette-pale/50 disabled:opacity-40"
                  >
                    Google Drive
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggleRowInstructions(row.id)}
                    className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-40"
                  >
                    {row.showAiInstructions ? "Hide AI instructions" : "Add AI instructions"}
                  </button>
                  <button
                    type="button"
                    aria-label="Move video up"
                    disabled={busy || rowIdx === 0}
                    onClick={() => moveRow(row.id, -1)}
                    className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Move video down"
                    disabled={busy || rowIdx === rows.length - 1}
                    onClick={() => moveRow(row.id, 1)}
                    className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label="Clear video"
                    disabled={busy || row.clips.length === 0}
                    onClick={() => clearRow(row.id)}
                    className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    aria-label="Remove video"
                    disabled={busy || rows.length === 1}
                    onClick={() => removeRow(row.id)}
                    className="rounded px-2 py-1 text-stone-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {row.clips.length === 0 ? (
                <p className="text-xs text-stone-500">No clips in this video yet.</p>
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
                          {c.file.name}
                        </p>
                        <p className="text-xs text-stone-500">
                          {formatBytes(c.file.size)}
                          {c.file.type ? ` · ${c.file.type}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Move clip up"
                          disabled={busy || idx === 0}
                          onClick={() => moveClip(row.id, c.id, -1)}
                          className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label="Move clip down"
                          disabled={busy || idx === row.clips.length - 1}
                          onClick={() => moveClip(row.id, c.id, 1)}
                          className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          aria-label="Remove clip"
                          disabled={busy}
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
                    disabled={busy}
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
          ))}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={startStitch}
          disabled={busy || nonEmptyRows.length < 1}
          className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "resuming"
            ? "Resuming…"
            : busy
              ? "Working…"
              : `Process ${nonEmptyRows.length} video${nonEmptyRows.length === 1 ? "" : "s"} → home`}
        </button>
      </section>

      {(busy || progressMsg || errorMsg) && (
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
              {busy && (
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
        disabled={busy}
        onAddClips={(files) => {
          if (!driveModalRowId) return false;
          return addFilesToRow(driveModalRowId, files);
        }}
      />

    </main>
  );
}
