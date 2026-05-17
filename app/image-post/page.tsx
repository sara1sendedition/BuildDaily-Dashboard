"use client";

import Image from "next/image";
import Link from "next/link";
import { ContentMultiplierHomeLink } from "@/app/components/ContentMultiplierMark";
import { FrameToneReviewCard } from "@/app/components/FrameToneReviewCard";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_COPY_CONTEXT_CHARS, getCopyContextFromStorage } from "@/lib/copy-context";
import { MAX_COPY_FEEDBACK_CHARS, getCopyFeedbackFromStorage } from "@/lib/copy-feedback";
import {
  MAX_REFERENCE_SOURCES_CHARS,
  getReferenceSourcesFromStorage,
} from "@/lib/reference-sources";
import {
  getDefaultCaptionCtaFromStorage,
  MAX_DEFAULT_CAPTION_CTA_CHARS,
} from "@/lib/default-caption-cta";
import {
  buildPostsZipBlob,
  safeFolderNameForPost,
  triggerBlobDownload,
} from "@/lib/download-posts-zip";
import {
  appendLearnedFromEditsLines,
  buildImagePostLearningLines,
  getLearnedFromEditsBlob,
  mergeCopyContextWithLearnings,
} from "@/lib/learned-from-edits";
import { clientApiPath } from "@/lib/client-api-path";
import { parseResponseJson } from "@/lib/parse-response-json";
import { appendVisualReferenceFormFields } from "@/lib/visual-reference-storage";
import { isLikelyVideoFile } from "@/lib/is-likely-video-file";
import type { TranscriptSegment } from "@/lib/types";

type ProcessResponse = {
  hook: string;
  microCta: string;
  caption: string;
  altText: string;
  evidenceSegmentIds: number[];
  transcript: TranscriptSegment[];
  durationSec: number;
  frameTimeSec: number;
  imageBase64: string;
};

type QueueItem = {
  id: string;
  file: File;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
  result?: ProcessResponse;
};

function GeneratingPostLoader({
  batch,
}: {
  batch?: { current: number; total: number } | null;
}) {
  const multi = batch && batch.total > 1;
  return (
    <div
      className="flex min-h-[240px] flex-col items-center justify-center gap-5 rounded-xl border border-stone-200 bg-white/90 px-6 py-14 shadow-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="text-base font-semibold tracking-tight text-stone-800">
        {multi
          ? `Generating post ${batch.current} of ${batch.total}`
          : "Generating Post"}
      </p>
      <div
        className="h-14 w-14 animate-spin rounded-full border-[3px] border-solid border-stone-200 border-t-palette-moss"
        aria-hidden
      />
    </div>
  );
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zipLoading, setZipLoading] = useState(false);
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [copiedAlt, setCopiedAlt] = useState(false);
  const [editTextOpen, setEditTextOpen] = useState(false);
  const [draftHook, setDraftHook] = useState("");
  const [draftMicroCta, setDraftMicroCta] = useState("");
  const [draftCaption, setDraftCaption] = useState("");
  const [rerenderingText, setRerenderingText] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const draftHookRef = useRef("");
  const draftMicroCtaRef = useRef("");
  const draftCaptionRef = useRef("");
  const editDialogWasOpenRef = useRef(false);

  const activeItem =
    activeQueueId === null
      ? null
      : queue.find((q) => q.id === activeQueueId) ?? null;
  const result = activeItem?.result ?? null;
  const videoFile = activeItem?.file ?? null;

  useEffect(() => {
    if (editTextOpen && !editDialogWasOpenRef.current && result) {
      setDraftHook(result.hook);
      setDraftMicroCta(result.microCta);
      setDraftCaption(result.caption);
      draftHookRef.current = result.hook;
      draftMicroCtaRef.current = result.microCta;
      draftCaptionRef.current = result.caption;
    }
    editDialogWasOpenRef.current = editTextOpen;
  }, [editTextOpen, result]);

  const prevActiveQueueIdRef = useRef<string | null>(activeQueueId);
  useEffect(() => {
    const prev = prevActiveQueueIdRef.current;
    if (prev !== activeQueueId && editTextOpen) {
      setEditTextOpen(false);
    }
    prevActiveQueueIdRef.current = activeQueueId;
  }, [activeQueueId, editTextOpen]);

  useEffect(() => {
    draftHookRef.current = draftHook;
    draftMicroCtaRef.current = draftMicroCta;
    draftCaptionRef.current = draftCaption;
  }, [draftHook, draftMicroCta, draftCaption]);

  const executeProcessRequest = useCallback(
    async (params: {
      file: File;
      reuseTranscription: boolean;
      transcript?: TranscriptSegment[];
      /** Snapshot for previousPlan when regenerating with feedback */
      planForFeedback: ProcessResponse | null;
    }) => {
      const fd = new FormData();
      fd.append("video", params.file);
      const contextStored = getCopyContextFromStorage().trim();
      const learnedBlob = getLearnedFromEditsBlob().trim();
      const mergedCopy = mergeCopyContextWithLearnings(
        contextStored || undefined,
        learnedBlob || undefined
      );
      if (mergedCopy) {
        fd.append("copyContext", mergedCopy.slice(0, MAX_COPY_CONTEXT_CHARS));
      }
      const defaultCaptionCta = getDefaultCaptionCtaFromStorage().trim();
      if (defaultCaptionCta) {
        fd.append(
          "defaultCaptionCta",
          defaultCaptionCta.slice(0, MAX_DEFAULT_CAPTION_CTA_CHARS)
        );
      }
      const sourcesStored = getReferenceSourcesFromStorage().trim();
      if (sourcesStored) {
        fd.append(
          "referenceSources",
          sourcesStored.slice(0, MAX_REFERENCE_SOURCES_CHARS)
        );
      }
      if (params.reuseTranscription && params.transcript?.length) {
        fd.append("reuseTranscription", "1");
        fd.append("transcript", JSON.stringify(params.transcript));
      }

      const feedbackTrimmed = getCopyFeedbackFromStorage().trim();
      if (feedbackTrimmed) {
        fd.append(
          "copyFeedback",
          feedbackTrimmed.slice(0, MAX_COPY_FEEDBACK_CHARS)
        );
      }
      if (
        params.reuseTranscription &&
        feedbackTrimmed &&
        params.planForFeedback
      ) {
        fd.append(
          "previousPlan",
          JSON.stringify({
            hook: params.planForFeedback.hook,
            microCta: params.planForFeedback.microCta,
            caption: params.planForFeedback.caption,
            altText: params.planForFeedback.altText,
          })
        );
      }
      appendVisualReferenceFormFields(fd);

      const res = await fetch(clientApiPath("/api/image-post/process"), {
        method: "POST",
        body: fd,
      });
      const data = await parseResponseJson<
        ProcessResponse & { error?: string }
      >(res);
      if (!res.ok) {
        throw new Error(data.error ?? "Request failed");
      }
      return data;
    },
    []
  );

  const patchQueue = useCallback(
    (updater: (prev: QueueItem[]) => QueueItem[]) => {
      setQueue((prev) => {
        const next = updater(prev);
        queueRef.current = next;
        return next;
      });
    },
    []
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    setError(null);
    setCopiedCaption(false);
    setCopiedAlt(false);
    setBatchProgress(null);
    try {
      const pendingAtStart = queueRef.current.filter(
        (q) => q.status === "pending"
      ).length;
      let done = 0;
      while (true) {
        const item = queueRef.current.find((q) => q.status === "pending");
        if (!item) break;
        done++;
        if (pendingAtStart > 1) {
          setBatchProgress({ current: done, total: pendingAtStart });
        }
        patchQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: "processing" } : q
          )
        );
        try {
          const data = await executeProcessRequest({
            file: item.file,
            reuseTranscription: false,
            planForFeedback: null,
          });
          patchQueue((prev) =>
            prev.map((q) =>
              q.id === item.id ? { ...q, status: "done", result: data } : q
            )
          );
        } catch (e) {
          const msg =
            e instanceof Error ? e.message : "Something went wrong";
          patchQueue((prev) =>
            prev.map((q) =>
              q.id === item.id ? { ...q, status: "error", error: msg } : q
            )
          );
          setError(msg);
          break;
        }
      }
    } finally {
      processingRef.current = false;
      setLoading(false);
      setBatchProgress(null);
    }
  }, [executeProcessRequest, patchQueue]);

  const enqueueVideos = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const newItems: QueueItem[] = files.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        status: "pending",
      }));
      // Update ref synchronously so processQueue sees new pending items.
      // setQueue alone can batch; its updater may run after processQueue().
      const next = [...queueRef.current, ...newItems];
      queueRef.current = next;
      setQueue(next);
      setActiveQueueId(newItems[0]!.id);
      setError(null);
      void processQueue();
    },
    [processQueue]
  );

  const handleDownloadAllZip = useCallback(async () => {
    const doneItems = queue.filter(
      (q): q is QueueItem & { result: ProcessResponse } =>
        q.status === "done" && q.result !== undefined
    );
    if (doneItems.length === 0) return;
    setZipLoading(true);
    try {
      const entries = doneItems.map((q, i) => ({
        folderName: safeFolderNameForPost(q.file.name, i),
        result: q.result,
      }));
      const blob = await buildPostsZipBlob(entries);
      triggerBlobDownload(blob, "image_posts.zip");
    } finally {
      setZipLoading(false);
    }
  }, [queue]);

  const runProcess = useCallback(
    async (opts: {
      reuseTranscription: boolean;
      transcript?: TranscriptSegment[];
      file?: File | null;
    }) => {
      if (!opts.reuseTranscription) {
        return;
      }
      const id = activeQueueId;
      if (!id) {
        setError("Select a post in the queue first.");
        return;
      }
      const item = queueRef.current.find((q) => q.id === id);
      const file =
        opts.file !== undefined ? opts.file ?? null : item?.file ?? null;
      if (!file || !opts.transcript?.length) {
        setError("Need a video and a previous transcript to reuse.");
        return;
      }

      setLoading(true);
      setError(null);
      setCopiedCaption(false);
      setCopiedAlt(false);
      setBatchProgress(null);

      try {
        const data = await executeProcessRequest({
          file,
          reuseTranscription: true,
          transcript: opts.transcript,
          planForFeedback: item?.result ?? null,
        });
        patchQueue((prev) =>
          prev.map((q) => (q.id === id ? { ...q, result: data } : q))
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [activeQueueId, executeProcessRequest, patchQueue]
  );

  const applyEditedText = useCallback(async () => {
    if (!activeQueueId) return;
    const item = queueRef.current.find((q) => q.id === activeQueueId);
    if (!item?.result) return;
    const prevResult = item.result;
    const beforeText = {
      hook: prevResult.hook,
      microCta: prevResult.microCta,
      caption: prevResult.caption,
    };
    const hook = draftHookRef.current;
    const microCta = draftMicroCtaRef.current;
    const caption = draftCaptionRef.current;
    const imageNeedsUpdate =
      hook !== prevResult.hook || microCta !== prevResult.microCta;

    if (imageNeedsUpdate) {
      if (!item.file) {
        setError(
          "To update text on the image, choose the same video file again (left column), then try Apply."
        );
        return;
      }
      setRerenderingText(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append("video", item.file);
        fd.append("frameTimeSec", String(prevResult.frameTimeSec));
        fd.append("hook", hook);
        fd.append("microCta", microCta);
        appendVisualReferenceFormFields(fd);
        const res = await fetch(clientApiPath("/api/image-post/render-post"), {
          method: "POST",
          body: fd,
        });
        const data = await parseResponseJson<{
          imageBase64?: string;
          error?: string;
        }>(res);
        if (!res.ok) {
          throw new Error(data.error ?? "Could not update image");
        }
        const nextImageBase64 = data.imageBase64;
        if (!nextImageBase64) {
          throw new Error("Missing image in response");
        }
        patchQueue((prev) =>
          prev.map((q) =>
            q.id === activeQueueId && q.result
              ? {
                  ...q,
                  result: {
                    ...q.result,
                    hook,
                    microCta,
                    caption,
                    imageBase64: nextImageBase64,
                  },
                }
              : q
          )
        );
        const imgLines = buildImagePostLearningLines(beforeText, {
          hook,
          microCta,
          caption,
        });
        if (imgLines.length > 0) {
          appendLearnedFromEditsLines(imgLines);
        }
        setEditTextOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update image");
      } finally {
        setRerenderingText(false);
      }
      return;
    }

    patchQueue((prev) =>
      prev.map((q) =>
        q.id === activeQueueId && q.result
          ? { ...q, result: { ...q.result, caption } }
          : q
      )
    );
    const imgLines = buildImagePostLearningLines(beforeText, {
      hook,
      microCta,
      caption,
    });
    if (imgLines.length > 0) {
      appendLearnedFromEditsLines(imgLines);
    }
    setEditTextOpen(false);
  }, [activeQueueId, patchQueue]);

  const rebuildImageWithToneOnly = useCallback(async () => {
    if (!activeQueueId) return;
    const item = queueRef.current.find((q) => q.id === activeQueueId);
    if (!item?.result || !item.file) {
      setError(
        "Need the generated image and the same video file in the queue to rebuild."
      );
      return;
    }
    const r = item.result;
    setRerenderingText(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("video", item.file);
      fd.append("frameTimeSec", String(r.frameTimeSec));
      fd.append("hook", r.hook);
      fd.append("microCta", r.microCta);
      appendVisualReferenceFormFields(fd);
      const res = await fetch(clientApiPath("/api/image-post/render-post"), {
        method: "POST",
        body: fd,
      });
      const data = await parseResponseJson<{
        imageBase64?: string;
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data.error ?? "Could not rebuild image");
      }
      const nextImageBase64 = data.imageBase64;
      if (!nextImageBase64) throw new Error("Missing image in response");
      patchQueue((prev) =>
        prev.map((q) =>
          q.id === activeQueueId && q.result
            ? { ...q, result: { ...q.result, imageBase64: nextImageBase64 } }
            : q
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rebuild image");
    } finally {
      setRerenderingText(false);
    }
  }, [activeQueueId, patchQueue]);

  const imageSrc = result?.imageBase64
    ? `data:image/png;base64,${result.imageBase64}`
    : null;
  const imagePreviewKey =
    result?.imageBase64 && result.imageBase64.length > 0
      ? `png-${result.imageBase64.length}-${result.imageBase64.slice(0, 24)}-${result.imageBase64.slice(-24)}`
      : "png-empty";

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 pb-20">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-3">
        <ContentMultiplierHomeLink className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-palette-teal/60 hover:bg-palette-pale/20 hover:text-stone-900" />
        <h1 className="order-last w-full text-center text-2xl font-bold text-stone-900 sm:order-none sm:w-auto sm:text-3xl">
          Video → Image Post
        </h1>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Link
            href="/settings"
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-palette-teal/60 hover:bg-palette-pale/20 hover:text-stone-900"
          >
            Settings
          </Link>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-10">
        <div className="rounded-2xl border border-stone-200/80 bg-white/90 p-6 shadow-sm backdrop-blur">
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2">
              <input
                ref={fileInputRef}
                id="video-input"
                type="file"
                accept="video/*,.mp4,.mov,.webm,.m4v"
                multiple
                disabled={loading}
                tabIndex={-1}
                className="sr-only"
                aria-label="Choose one or more video files"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  const videos = list.filter(isLikelyVideoFile);
                  e.target.value = "";
                  if (videos.length === 0) {
                    if (list.length > 0) {
                      setError(
                        "None of the selected files look like supported videos (e.g. .mp4, .mov). Try MP4 export if the picker allowed a non-video type."
                      );
                    }
                    return;
                  }
                  enqueueVideos(videos);
                }}
              />
              {loading ? (
                <span
                  className="rounded-lg border-0 bg-palette-moss px-4 py-2 text-sm font-semibold text-stone-900 opacity-60"
                  aria-busy="true"
                >
                  Choose file(s)
                </span>
              ) : (
                <label
                  htmlFor="video-input"
                  className="cursor-pointer rounded-lg border-0 bg-palette-moss px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-palette-depth hover:text-stone-950"
                >
                  Choose file(s)
                </label>
              )}
              <p className="max-w-full text-center text-xs text-stone-500">
                Add videos to the queue; click a card to view that post.
              </p>
            </div>

            {queue.length > 0 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Queue
                  </p>
                  <button
                    type="button"
                    disabled={
                      zipLoading ||
                      queue.every(
                        (q) => q.status !== "done" || !q.result
                      )
                    }
                    onClick={() => void handleDownloadAllZip()}
                    className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 shadow-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {zipLoading ? "Zipping…" : "Download all (ZIP)"}
                  </button>
                </div>
                <ul className="max-h-[min(40vh,320px)] space-y-2 overflow-y-auto pr-1">
                  {queue.map((q) => {
                    const active = q.id === activeQueueId;
                    const statusLabel =
                      q.status === "pending"
                        ? "Waiting"
                        : q.status === "processing"
                          ? "Processing"
                          : q.status === "done"
                            ? "Done"
                            : "Error";
                    return (
                      <li key={q.id}>
                        <button
                          type="button"
                          onClick={() => setActiveQueueId(q.id)}
                          className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                            active
                              ? "border-palette-moss bg-palette-pale/80 shadow-sm ring-1 ring-palette-moss/30"
                              : "border-stone-200 bg-white/80 hover:border-stone-300 hover:bg-stone-50"
                          }`}
                        >
                          <span className="block truncate font-medium text-stone-900">
                            {q.file.name}
                          </span>
                          <span
                            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              q.status === "done"
                                ? "bg-emerald-100 text-emerald-900"
                                : q.status === "error"
                                  ? "bg-red-100 text-red-900"
                                  : q.status === "processing"
                                    ? "bg-amber-100 text-amber-900"
                                    : "bg-stone-200 text-stone-700"
                            }`}
                          >
                            {statusLabel}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}
          </div>
        </div>

        <section
          className="min-h-[12rem] space-y-6 rounded-2xl border border-stone-200/80 bg-stone-50/80 p-6 shadow-sm backdrop-blur lg:min-h-0"
          aria-label="Output"
          aria-busy={loading && !result}
        >
          {queue.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white/60 px-4 py-12 text-center text-sm text-stone-500">
              Choose a file to generate your post
            </div>
          ) : !activeItem ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white/60 px-4 py-12 text-center text-sm text-stone-500">
              Select a video in the queue
            </div>
          ) : activeItem.status === "error" ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-900">
              {activeItem.error ?? "Something went wrong"}
            </div>
          ) : loading && !result ? (
            <GeneratingPostLoader batch={batchProgress} />
          ) : !result ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white/60 px-4 py-12 text-center text-sm text-stone-500">
              {activeItem.status === "pending"
                ? "Waiting in queue…"
                : "Generating…"}
            </div>
          ) : (
            <>
              {imageSrc ? (
                <div className="mb-4">
                  <FrameToneReviewCard
                    variant="image"
                    previewSrc={imageSrc}
                    onApply={() => void rebuildImageWithToneOnly()}
                    busy={rerenderingText}
                    disabled={loading || !videoFile}
                  />
                </div>
              ) : null}
              <div className="relative overflow-hidden rounded-2xl border border-stone-200 bg-stone-100 shadow-inner">
                {imageSrc ? (
                  <Image
                    key={imagePreviewKey}
                    src={imageSrc}
                    alt={result.altText || "Generated 4:5 Instagram post"}
                    width={1080}
                    height={1350}
                    unoptimized
                    className="mx-auto max-h-[min(55vh,520px)] w-auto max-w-full object-contain"
                  />
                ) : null}
                {result.transcript?.length ? (
                  <button
                    type="button"
                    disabled={loading || !videoFile}
                    onClick={() =>
                      runProcess({
                        reuseTranscription: true,
                        transcript: result.transcript,
                      })
                    }
                    aria-label="Regenerate image post with AI (replaces copy on image)"
                    title="Regenerate image post with AI (replaces copy on image)"
                    className="absolute right-2 top-2 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-stone-200/90 bg-white/95 text-palette-depth shadow-md backdrop-blur-sm transition hover:bg-palette-pale/80 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5"
                      aria-hidden
                    >
                      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 0 6.74-2.74L21 4" />
                      <path d="M21 3v5h-5" />
                      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 20" />
                      <path d="M3 21v-5h5" />
                    </svg>
                  </button>
                ) : null}
              </div>

              <div className="rounded-xl border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                    Caption
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(result.caption);
                      setCopiedCaption(true);
                      setTimeout(() => setCopiedCaption(false), 2000);
                    }}
                    className="rounded-lg bg-palette-pale/50 px-3 py-1 text-xs font-medium text-stone-800 hover:bg-palette-pale"
                  >
                    {copiedCaption ? "Copied" : "Copy caption"}
                  </button>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
                  {result.caption}
                </p>
              </div>

              <div className="rounded-xl border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                    Alt text (Instagram)
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(result.altText);
                      setCopiedAlt(true);
                      setTimeout(() => setCopiedAlt(false), 2000);
                    }}
                    className="rounded-lg bg-palette-pale/50 px-3 py-1 text-xs font-medium text-stone-800 hover:bg-palette-pale"
                  >
                    {copiedAlt ? "Copied" : "Copy alt text"}
                  </button>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-stone-700">
                  {result.altText}
                </p>
                <p className="mt-2 text-xs text-stone-500">
                  Paste into the post&apos;s Accessibility → Alt text field when
                  you publish.
                </p>
              </div>

              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setEditTextOpen(true)}
                  disabled={loading}
                  className="rounded-xl border-2 border-palette-moss bg-palette-pale/70 px-6 py-2.5 text-sm font-semibold text-stone-900 shadow-sm hover:bg-palette-pale disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Edit text
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {editTextOpen && result && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-text-dialog-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]"
            onClick={() => !rerenderingText && setEditTextOpen(false)}
            aria-label="Close"
          />
          <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
            <h2
              id="edit-text-dialog-title"
              className="text-lg font-semibold text-stone-900"
            >
              Edit text
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Change the hook and subline on the image and the caption below.
              Updating the image reuses your video at the same frame time.
            </p>
            <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
              Changing <strong className="font-medium text-stone-800">only</strong>{" "}
              the caption updates the caption card below the preview, not the
              large image. Change hook or subline (or both) to rebuild the image.
            </p>

            <label className="mt-4 block text-sm font-medium text-stone-700">
              Hook (on image)
            </label>
            <textarea
              value={draftHook}
              onChange={(e) => setDraftHook(e.target.value)}
              rows={3}
              disabled={rerenderingText}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-stone-500">
              One line per visual row. Multi-color hooks use Settings → Visual
              references (Image post reference) line fills in order.
            </p>

            <label className="mt-4 block text-sm font-medium text-stone-700">
              Subline (on image)
            </label>
            <textarea
              value={draftMicroCta}
              onChange={(e) => setDraftMicroCta(e.target.value)}
              rows={2}
              disabled={rerenderingText}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm disabled:opacity-60"
            />

            <label className="mt-4 block text-sm font-medium text-stone-700">
              Caption
            </label>
            <textarea
              value={draftCaption}
              onChange={(e) => setDraftCaption(e.target.value)}
              rows={10}
              disabled={rerenderingText}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm leading-relaxed disabled:opacity-60"
            />

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditTextOpen(false)}
                disabled={rerenderingText}
                className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void applyEditedText()}
                disabled={rerenderingText}
                className="rounded-lg bg-palette-moss px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-palette-depth hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {rerenderingText ? "Updating…" : "Rebuild image & save"}
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
