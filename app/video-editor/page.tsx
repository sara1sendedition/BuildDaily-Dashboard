"use client";

/**
 * Video Editor — run Video to Short without multiplying into carousel / image /
 * X posts. Upload a finished video (or hand off stitched clips from /stitch?to=editor).
 */

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { QueueItemEditableTitle } from "@/app/components/QueueItemEditableTitle";
import { DriveInboxPanel } from "@/app/components/DriveInboxPanel";
import { ShortEditPanel } from "@/app/components/ShortEditPanel";
import { ShortPreviewPlayer } from "@/app/components/ShortPreviewPlayer";
import { mobileFriendlyMp4PreviewUrl } from "@/lib/media/mobile-friendly-mp4-preview-url";
import {
  useCarouselWorkspace,
  SHORT_ONLY_STUDIO_OUTPUTS,
} from "@/context/carousel-workspace-context";
import { useScheduleStore } from "@/context/schedule-context";
import { clientApiPath } from "@/lib/client-api-path";
import {
  getCarouselFocusFromStorage,
  MAX_CAROUSEL_FOCUS_CHARS,
  setCarouselFocusToStorage,
} from "@/lib/carousel-focus";
import { normalizeShortEditorialCuts } from "@/lib/normalize-short-editorial-cuts";
import { queueItemDisplayLabel } from "@/lib/queue-display-label";
import { peekStitchedFiles, clearStitchedFile } from "@/lib/stitch-handoff";
import {
  readStitchEnqueuedCreatedAt,
  readStitchHandoffQueueIds,
  claimStitchEnqueue,
  releaseStitchEnqueueClaimIfStillClaiming,
  stitchHandoffShouldSkipReenqueue,
  removeRetryableHandoffRows,
  stitchHandoffBatchFullyDone,
  stitchHandoffRetryFileIndexes,
  mergeStitchHandoffQueueIds,
} from "@/lib/stitch-handoff-consume";
import { setShortSourceTool } from "@/lib/short-source-tool";
import {
  readInFlightShortJob,
  clearInFlightShortJob,
  readPreUploadCorrelation,
  clearPreUploadCorrelation,
  lookupShortJobByCorrelationId,
  shortJobDownloadApiUrl,
  type InFlightShortJob,
} from "@/lib/run-video-to-short";

export default function VideoEditorPage() {
  const { syncTitlesForQueueItem } = useScheduleStore();
  const {
    queue,
    activeQueueId,
    selectQueueItem,
    removeQueueItem,
    renameQueueItem,
    enqueueFiles,
    error,
    fileInputRef,
    shortOutputFile,
    shortJobId,
    shortEditorialSummary,
    shortEditorialSkip,
    shortEditorialCuts,
    shortError,
    reelMp4Url,
    shortResumeBusy,
    shortResumeMessage,
    recoverInFlightShortForQueue,
    shortReprocessBusy,
    reprocessActiveShortOutput,
    flushActiveQueueSnapshot,
    hubQueueHydrationDone,
  } = useCarouselWorkspace();

  const videoUploadInputId = useId();
  const notesFieldId = useId();

  const [carouselFocusDraft, setCarouselFocusDraft] = useState("");
  const [videoToShortWarning, setVideoToShortWarning] = useState<string | null>(
    null
  );
  const [stitchedHandoffActive, setStitchedHandoffActive] = useState(false);

  const enqueueShortOnly = useCallback(
    (
      files: File[],
      opts?: { aiInstructionsByIndex?: Array<string | undefined> }
    ): string[] => {
      setShortSourceTool("video-editor");
      return enqueueFiles(files, {
        ...opts,
        studioOutputs: SHORT_ONLY_STUDIO_OUTPUTS,
      });
    },
    [enqueueFiles]
  );

  /** Only short-only rows — hide Multiplier carousel/image jobs from this page. */
  const editorQueue = useMemo(
    () =>
      queue.filter((item) => {
        const o = item.studioOutputs;
        if (!o) return false;
        return o.reelShort && !o.carousel && !o.imagePost && !o.xPost;
      }),
    [queue]
  );

  const activeQueueItem =
    editorQueue.find((q) => q.id === activeQueueId) ?? null;
  const activeItemProcessing = activeQueueItem?.status === "processing";
  const hasProcessed = activeQueueItem?.status === "done";

  useEffect(() => {
    if (editorQueue.length === 0) return;
    if (activeQueueId && editorQueue.some((q) => q.id === activeQueueId)) {
      return;
    }
    selectQueueItem(editorQueue[0]!.id);
  }, [editorQueue, activeQueueId, selectQueueItem]);

  useEffect(() => {
    setCarouselFocusDraft(getCarouselFocusFromStorage());
  }, []);

  const onNotesChange = useCallback((value: string) => {
    const v = value.slice(0, MAX_CAROUSEL_FOCUS_CHARS);
    setCarouselFocusDraft(v);
    setCarouselFocusToStorage(v);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(clientApiPath("/api/video-to-short/status"));
        if (cancelled || !res.ok) return;
        let data: {
          integrationEnabled?: boolean;
          clientSkipsShort?: boolean;
          apiBase?: string;
          backendReachable?: boolean | null;
        };
        try {
          data = (await res.json()) as typeof data;
        } catch {
          return;
        }
        if (cancelled) return;
        if (data.clientSkipsShort) {
          setVideoToShortWarning(
            "NEXT_PUBLIC_SKIP_VIDEO_TO_SHORT is set, so Short processing is skipped."
          );
          return;
        }
        if (data.integrationEnabled === false) {
          setVideoToShortWarning(
            "Video to Short integration is turned off (VIDEO_TO_SHORT_INTEGRATION)."
          );
          return;
        }
        if (data.backendReachable === false) {
          const where = data.apiBase?.trim() || "the configured URL";
          setVideoToShortWarning(
            `The Video to Short backend does not appear to be running (could not reach ${where}).`
          );
          return;
        }
        setVideoToShortWarning(null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Consume stitch handoff when destination is Video Editor.
  const [handoffQueueIds, setHandoffQueueIds] = useState<string[]>([]);
  useEffect(() => {
    if (!hubQueueHydrationDone) return;
    let cancelled = false;
    let claimedCreatedAt: number | null = null;
    (async () => {
      const peeked = await peekStitchedFiles();
      if (!peeked || cancelled) return;
      if (peeked.destination !== "video-editor") return;
      const alreadyEnqueued =
        readStitchEnqueuedCreatedAt() === String(peeked.createdAt);
      if (
        alreadyEnqueued &&
        stitchHandoffShouldSkipReenqueue(
          queue,
          peeked.createdAt,
          hubQueueHydrationDone
        )
      ) {
        setHandoffQueueIds(readStitchHandoffQueueIds(peeked.createdAt));
        setStitchedHandoffActive(true);
        return;
      }
      const retryIndexes = alreadyEnqueued
        ? stitchHandoffRetryFileIndexes(queue, peeked.createdAt)
        : null;
      if (retryIndexes && retryIndexes.length === 0) {
        setHandoffQueueIds(readStitchHandoffQueueIds(peeked.createdAt));
        setStitchedHandoffActive(true);
        return;
      }
      if (alreadyEnqueued) {
        removeRetryableHandoffRows(queue, peeked.createdAt, removeQueueItem);
        if (!claimStitchEnqueue(peeked.createdAt, { allowRetry: true })) {
          setHandoffQueueIds(readStitchHandoffQueueIds(peeked.createdAt));
          setStitchedHandoffActive(true);
          return;
        }
      } else if (!claimStitchEnqueue(peeked.createdAt)) {
        setHandoffQueueIds(readStitchHandoffQueueIds(peeked.createdAt));
        setStitchedHandoffActive(true);
        return;
      }
      claimedCreatedAt = peeked.createdAt;
      if (cancelled) {
        releaseStitchEnqueueClaimIfStillClaiming(peeked.createdAt);
        return;
      }
      const filesToEnqueue =
        retryIndexes === null
          ? peeked.files
          : retryIndexes.map((i) => peeked.files[i]!).filter(Boolean);
      const notes =
        retryIndexes === null
          ? peeked.aiInstructionsByFile
          : retryIndexes.map((i) => peeked.aiInstructionsByFile[i]);
      const newIds = enqueueShortOnly(filesToEnqueue, {
        aiInstructionsByIndex: notes,
      });
      const mergedIds = mergeStitchHandoffQueueIds(
        peeked.createdAt,
        peeked.files.length,
        retryIndexes,
        newIds
      );
      if (mergedIds.length === 0) {
        releaseStitchEnqueueClaimIfStillClaiming(peeked.createdAt);
        claimedCreatedAt = null;
        return;
      }
      claimedCreatedAt = null;
      if (cancelled) return;
      setHandoffQueueIds(mergedIds);
      setStitchedHandoffActive(true);
    })();
    return () => {
      cancelled = true;
      if (claimedCreatedAt != null) {
        releaseStitchEnqueueClaimIfStillClaiming(claimedCreatedAt);
      }
    };
  }, [enqueueShortOnly, queue, removeQueueItem, hubQueueHydrationDone]);

  useEffect(() => {
    if (!stitchedHandoffActive) return;
    if (!stitchHandoffBatchFullyDone(queue, handoffQueueIds)) return;
    void clearStitchedFile();
    setStitchedHandoffActive(false);
    setHandoffQueueIds([]);
  }, [queue, stitchedHandoffActive, handoffQueueIds]);

  const [inFlightShortJob, setInFlightShortJob] =
    useState<InFlightShortJob | null>(null);
  const [recoveringShort, setRecoveringShort] = useState(false);
  const [recoverShortError, setRecoverShortError] = useState<string | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const record = readInFlightShortJob();
      if (record) {
        if (!cancelled) setInFlightShortJob(record);
        return;
      }
      const orphan = readPreUploadCorrelation();
      if (!orphan) return;
      try {
        const lookup = await lookupShortJobByCorrelationId(orphan.correlationId);
        if (cancelled) return;
        if (!lookup) {
          clearPreUploadCorrelation();
          return;
        }
        setInFlightShortJob({
          jobId: lookup.jobId,
          createdAt: orphan.createdAt,
          sourceName: orphan.sourceName,
        });
        clearPreUploadCorrelation();
      } catch {
        /* retry next mount */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRecoverInFlightShort = useCallback(async () => {
    if (!inFlightShortJob) return;
    setRecoveringShort(true);
    setRecoverShortError(null);
    try {
      await recoverInFlightShortForQueue(inFlightShortJob);
      setInFlightShortJob(null);
    } catch (err) {
      setRecoverShortError(
        err instanceof Error ? err.message : "Recovery failed"
      );
    } finally {
      setRecoveringShort(false);
    }
  }, [inFlightShortJob, recoverInFlightShortForQueue]);

  const shortEditorialCutRows = useMemo(
    () => normalizeShortEditorialCuts(shortEditorialCuts),
    [shortEditorialCuts]
  );

  const showShortEditorialReport = useMemo(
    () =>
      hasProcessed &&
      Boolean(
        shortEditorialSummary ||
          shortEditorialSkip ||
          shortEditorialCutRows.length > 0
      ),
    [
      hasProcessed,
      shortEditorialSummary,
      shortEditorialSkip,
      shortEditorialCutRows.length,
    ]
  );

  const shortJobPreviewEligible = useMemo(() => {
    if (!hasProcessed || !shortJobId?.trim()) return false;
    if (shortOutputFile || reelMp4Url) return false;
    if (showShortEditorialReport || shortResumeBusy) return true;
    if (!shortError) return true;
    const err = shortError.toLowerCase();
    return (
      err.includes("download failed") ||
      err.includes("lost connection") ||
      err.includes("load it automatically") ||
      err.includes("still processing")
    );
  }, [
    hasProcessed,
    shortJobId,
    shortOutputFile,
    reelMp4Url,
    showShortEditorialReport,
    shortResumeBusy,
    shortError,
  ]);

  const [shortPreviewUrl, setShortPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hasProcessed) {
      setShortPreviewUrl(null);
      return;
    }
    if (shortOutputFile && shortOutputFile.size > 0) {
      const url = URL.createObjectURL(shortOutputFile);
      setShortPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    const remote = reelMp4Url?.trim();
    if (remote) {
      setShortPreviewUrl(mobileFriendlyMp4PreviewUrl(remote));
      return;
    }
    if (shortJobPreviewEligible && shortJobId) {
      setShortPreviewUrl(shortJobDownloadApiUrl(shortJobId));
      return;
    }
    setShortPreviewUrl(null);
  }, [
    shortOutputFile,
    hasProcessed,
    reelMp4Url,
    shortJobPreviewEligible,
    shortJobId,
  ]);

  const downloadShortMp4 = useCallback(() => {
    if (shortOutputFile) {
      const url = URL.createObjectURL(shortOutputFile);
      const a = document.createElement("a");
      a.href = url;
      a.download = shortOutputFile.name || "short.mp4";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    if (reelMp4Url) {
      const a = document.createElement("a");
      a.href = reelMp4Url;
      a.download = "short.mp4";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
      return;
    }
    if (shortJobId) {
      window.open(shortJobDownloadApiUrl(shortJobId), "_blank", "noopener");
    }
  }, [shortOutputFile, reelMp4Url, shortJobId]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 pb-24">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
          Video Editor
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-stone-600">
          Turn a video into a captioned short — without carousel, image post, or
          other Multiplier formats. Upload a finished take, or{" "}
          <Link
            href="/stitch?to=editor"
            className="font-medium text-palette-depth underline decoration-palette-depth/30 underline-offset-2 hover:text-stone-900"
          >
            combine clips in Stitch
          </Link>{" "}
          first.
        </p>
      </header>

      {error ? (
        <p className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {videoToShortWarning ? (
        <p
          className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-950"
          role="status"
        >
          <span className="font-semibold">Video to Short: </span>
          {videoToShortWarning}
        </p>
      ) : null}

      {inFlightShortJob ? (
        <div className="mb-6 rounded-lg border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-950">
          <p className="font-semibold">Short still on the server</p>
          <p className="mt-1 text-sky-900/90">
            {inFlightShortJob.sourceName
              ? `Recover “${inFlightShortJob.sourceName}” without re-uploading.`
              : "A Short job was interrupted — recover it without re-uploading."}
          </p>
          {recoverShortError ? (
            <p className="mt-2 text-red-700">{recoverShortError}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={recoveringShort}
              onClick={() => void handleRecoverInFlightShort()}
              className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
            >
              {recoveringShort ? "Recovering…" : "Recover short"}
            </button>
            <button
              type="button"
              disabled={recoveringShort}
              onClick={() => {
                clearInFlightShortJob();
                setInFlightShortJob(null);
                setRecoverShortError(null);
              }}
              className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-900 hover:bg-sky-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-3 lg:gap-8">
        <div className="min-w-0 space-y-3 lg:col-span-1">
          <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 text-sm text-stone-700 shadow-sm">
            <p className="font-semibold text-stone-900">Output</p>
            <p className="mt-1 text-stone-600">
              Reel / Short only — Multiplier formats stay off.
            </p>
          </div>

          <details className="group rounded-2xl border border-stone-200/80 bg-white text-left shadow-sm [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-stone-900 marker:content-none hover:bg-stone-50/80">
              <span>Studio run notes for the AI (optional)</span>
              <span
                className="shrink-0 text-stone-400 transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              >
                ▼
              </span>
            </summary>
            <div className="border-t border-stone-100 px-4 pb-4 pt-2">
              <label htmlFor={notesFieldId} className="sr-only">
                Studio run notes for the AI (optional)
              </label>
              <textarea
                id={notesFieldId}
                value={carouselFocusDraft}
                onChange={(e) => onNotesChange(e.target.value)}
                rows={5}
                maxLength={MAX_CAROUSEL_FOCUS_CHARS}
                placeholder='e.g. "Keep energy high, cut long pauses, no new claims."'
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400"
              />
              <p className="mt-1 text-xs text-stone-400">
                {carouselFocusDraft.length.toLocaleString()} /{" "}
                {MAX_CAROUSEL_FOCUS_CHARS.toLocaleString()} · Saved in this
                browser
              </p>
            </div>
          </details>

          <DriveInboxPanel
            onEnqueueFiles={(files) => enqueueShortOnly(files)}
            disabled={queue.some((q) => q.status === "processing")}
          />

          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-palette-sage bg-white p-4 text-center shadow-md shadow-stone-200/50">
            <input
              id={videoUploadInputId}
              ref={fileInputRef}
              type="file"
              accept="video/*,.mp4,.mov,.webm,.m4v"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose one or more video files"
              onChange={(e) => {
                const list = e.target.files;
                if (list?.length) {
                  enqueueShortOnly(Array.from(list));
                }
                e.target.value = "";
              }}
            />
            <label
              htmlFor={videoUploadInputId}
              className="inline-flex cursor-pointer select-none justify-center rounded-lg bg-palette-moss px-4 py-2 text-sm font-medium text-white transition hover:bg-palette-depth"
            >
              Upload video
            </label>
            <Link
              href="/stitch?to=editor"
              className="text-xs font-medium text-palette-depth underline decoration-palette-depth/30 underline-offset-2 hover:text-stone-900"
            >
              Or combine multiple takes in Stitch →
            </Link>
          </div>

          <div className="mx-auto w-full max-w-full space-y-3 lg:max-w-none">
            {editorQueue.length > 0 ? (
              <div className="max-h-[min(52vh,22rem)] space-y-3 overflow-y-auto pr-0.5">
                {editorQueue.map((item) => {
                  const isActive = item.id === activeQueueId;
                  const handleRename = (id: string, displayLabel: string) => {
                    renameQueueItem(id, displayLabel);
                    syncTitlesForQueueItem(
                      id,
                      displayLabel.trim() || undefined,
                      item.file.name
                    );
                  };
                  return (
                    <div
                      key={item.id}
                      title={
                        item.status === "error" && item.error
                          ? item.error
                          : `${queueItemDisplayLabel(item)} (${item.file.name})`
                      }
                      className={`flex w-full flex-col gap-2 rounded-2xl border p-3 text-left shadow-sm transition ${
                        isActive
                          ? "border-palette-teal bg-palette-pale/25 ring-2 ring-palette-pale/50"
                          : "border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50"
                      }`}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <QueueItemEditableTitle
                          item={item}
                          onSelect={() => selectQueueItem(item.id)}
                          onRename={handleRename}
                        />
                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              item.status === "done"
                                ? "bg-palette-pale/35 text-palette-depth"
                                : item.status === "processing"
                                  ? "bg-palette-pale/35 text-palette-depth"
                                  : item.status === "error"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-stone-200 text-stone-600"
                            }`}
                          >
                            {item.status === "pending"
                              ? "Waiting"
                              : item.status === "processing"
                                ? "Processing"
                                : item.status === "done"
                                  ? "Done"
                                  : "Error"}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeQueueItem(item.id);
                            }}
                            aria-label={`Remove ${queueItemDisplayLabel(item)} from queue`}
                            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-sm leading-none text-stone-400 transition hover:bg-stone-200/80 hover:text-stone-700"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      {item.status === "processing" ? (
                        <button
                          type="button"
                          onClick={() => selectQueueItem(item.id)}
                          className="flex w-full flex-col gap-2 text-left"
                        >
                          <div
                            className="h-0.5 w-full overflow-hidden rounded-full bg-stone-200"
                            aria-hidden
                          >
                            <div className="h-full w-1/3 animate-pulse rounded-full bg-palette-moss" />
                          </div>
                          {item.progress ? (
                            <p
                              className="max-w-full truncate text-[11px] leading-snug text-stone-500"
                              title={item.progress}
                            >
                              {item.progress}
                            </p>
                          ) : null}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3" aria-hidden>
                {Array.from({ length: 3 }, (_, i) => (
                  <div
                    key={i}
                    className="h-12 w-full rounded-2xl border border-stone-200 bg-stone-100/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.8)]"
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          className={`flex min-h-[min(420px,60vh)] min-w-0 flex-col rounded-2xl border p-6 shadow-md lg:col-span-2 ${
            activeItemProcessing
              ? "border-palette-pale/40 bg-gradient-to-b from-palette-pale/30 via-palette-pale/15 to-slate-50/80 shadow-palette-pale/25"
              : "border-stone-200 bg-white shadow-stone-200/40"
          }`}
        >
          {activeItemProcessing ? (
            <div
              className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center"
              role="status"
              aria-live="polite"
            >
              <div
                className="mb-5 h-14 w-14 rounded-full border-[3px] border-palette-pale/80 border-t-palette-depth animate-spin"
                aria-hidden
              />
              <p className="text-base font-medium text-stone-800">
                {activeQueueItem?.progress ?? "Creating your short"}
              </p>
              <p className="mt-2 max-w-md text-sm text-stone-600">
                Running Video to Short only — no carousel or image post.
              </p>
            </div>
          ) : !hasProcessed ? (
            <div className="flex flex-1 flex-col items-center justify-center px-2 text-center">
              <div
                className="mb-6 flex h-24 w-24 items-center justify-center rounded-2xl border border-stone-200 bg-stone-100 text-stone-500"
                aria-hidden
              >
                <svg
                  className="h-12 w-12"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.25}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <p className="text-base font-medium text-stone-800">
                No short yet
              </p>
              <p className="mt-2 max-w-sm text-sm text-stone-600">
                Upload a video to run Video to Short, or stitch clips first and
                send them here.
              </p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-6">
              <h2 className="text-lg font-medium text-stone-900">Short</h2>

              {shortError ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  {shortError}
                </p>
              ) : null}

              <div className="relative flex flex-col items-center">
                {shortReprocessBusy || shortResumeBusy ? (
                  <div
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-white/85 px-4 text-center backdrop-blur-[2px]"
                    role="status"
                  >
                    <div
                      className="mb-3 h-10 w-10 rounded-full border-[3px] border-palette-pale/80 border-t-palette-depth animate-spin"
                      aria-hidden
                    />
                    <p className="text-sm font-medium text-stone-800">
                      {shortReprocessBusy
                        ? "Re-processing short…"
                        : shortResumeMessage || "Loading reel…"}
                    </p>
                  </div>
                ) : null}
                {shortPreviewUrl ? (
                  <ShortPreviewPlayer
                    url={shortPreviewUrl}
                    blocked={shortReprocessBusy}
                  />
                ) : (
                  <p className="text-sm text-stone-600">
                    {shortResumeBusy
                      ? shortResumeMessage || "Reel is still processing…"
                      : "Preparing preview…"}
                  </p>
                )}
              </div>

              <ShortEditPanel
                shortJobId={shortJobId ?? null}
                busy={shortReprocessBusy}
                shortPreviewUrl={shortPreviewUrl}
                onReprocess={reprocessActiveShortOutput}
              />

              {showShortEditorialReport ? (
                <details className="rounded-xl border border-stone-200 bg-stone-50/90 text-left shadow-sm [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-stone-900">
                    <span>What smart editorial did</span>
                    <span className="text-stone-400" aria-hidden>
                      ▼
                    </span>
                  </summary>
                  <div className="border-t border-stone-200/60 px-4 pb-4 pt-2 text-sm text-stone-800">
                    {shortEditorialSkip ? (
                      <p className="text-amber-950">
                        Smart editorial was skipped — {shortEditorialSkip}
                      </p>
                    ) : shortEditorialSummary ? (
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {shortEditorialSummary}
                      </p>
                    ) : null}
                  </div>
                </details>
              ) : null}

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Download &amp; schedule
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={downloadShortMp4}
                    disabled={!shortOutputFile && !reelMp4Url && !shortJobId}
                    className="flex-1 rounded-xl bg-palette-moss py-3 text-sm font-semibold text-white transition hover:bg-palette-depth disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Download short (MP4)
                  </button>
                  <Link
                    href="/schedule"
                    onClick={(e) => {
                      if (!hasProcessed) {
                        e.preventDefault();
                        return;
                      }
                      flushActiveQueueSnapshot();
                    }}
                    className={`flex-1 rounded-xl border-2 border-palette-moss bg-white py-3 text-center text-sm font-semibold text-palette-moss transition hover:bg-palette-pale/30 ${
                      !hasProcessed ? "pointer-events-none opacity-50" : ""
                    }`}
                  >
                    Schedule on calendar
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
