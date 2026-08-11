"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  CarouselSlideViewer,
  type CarouselPreviewPlatform,
} from "@/app/components/CarouselSlideViewer";
import { ImagePostStudioPanel } from "@/app/components/ImagePostStudioPanel";
import { SocialMicroPanel } from "@/app/components/SocialMicroPanel";
import { RefinePanel } from "@/app/components/RefinePanel";
import { CollapsibleSection } from "@/app/components/CollapsibleSection";
import { FrameColorAdjustSliders } from "@/app/components/FrameColorAdjustSliders";
import { useCarouselWorkspace } from "@/context/carousel-workspace-context";
import { useScheduleStore } from "@/context/schedule-context";
import { QueueItemEditableTitle } from "@/app/components/QueueItemEditableTitle";
import { clientApiPath } from "@/lib/client-api-path";
import { frameColorAdjustToCssFilter } from "@/lib/frame-color-adjust";
import {
  postMetaCarouselPublish,
  postMetaReelPublish,
} from "@/lib/meta/publish-meta-client";
import { postYoutubeShortPublish } from "@/lib/youtube/publish-youtube-client";
import { mobileFriendlyMp4PreviewUrl } from "@/lib/media/mobile-friendly-mp4-preview-url";
import { ShortPreviewPlayer } from "@/app/components/ShortPreviewPlayer";
import { slidesForMetaFromZipOrSnapshot } from "@/lib/schedule/slides-for-meta-from-snapshot";
import {
  getCarouselFocusFromStorage,
  MAX_CAROUSEL_FOCUS_CHARS,
  setCarouselFocusToStorage,
} from "@/lib/carousel-focus";
import { ShortEditPanel } from "@/app/components/ShortEditPanel";
import { X_THREADS_OUTPUT_ENABLED } from "@/lib/studio-output-flags";
import { DriveInboxPanel } from "@/app/components/DriveInboxPanel";
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
import {
  readInFlightShortJob,
  clearInFlightShortJob,
  readPreUploadCorrelation,
  clearPreUploadCorrelation,
  lookupShortJobByCorrelationId,
  shortJobDownloadApiUrl,
  type InFlightShortJob,
} from "@/lib/run-video-to-short";
import { normalizeShortEditorialCuts } from "@/lib/normalize-short-editorial-cuts";
import { queueItemDisplayLabel } from "@/lib/queue-display-label";
import { setShortSourceTool } from "@/lib/short-source-tool";
import { isMobileClient } from "@/lib/mobile-client";

type StudioTab = "carousel" | "image" | "social" | "short";
type MetaPublishContentKind = "carousel" | "photo" | "short";

export default function Home() {
  const { syncTitlesForQueueItem } = useScheduleStore();
  const {
    queue,
    activeQueueId,
    selectQueueItem,
    removeQueueItem,
    renameQueueItem,
    enqueueFiles,
    error,
    recommendation,
    slidePreviewBase64s,
    slidePreviewBase64sInstagram,
    fileInputRef,
    zipBase64,
    downloadZip,
    downloadAllZips,
    downloadAllZipsLoading,
    canDownloadAllZips,
    imagePost,
    downloadImagePostPng,
    editableSlides,
    socialCaption,
    setSocialCaption,
    loading,
    reRenderLoading,
    reRenderProgress,
    reRenderZip,
    flushActiveQueueSnapshot,
    frameColorAdjust,
    setFrameColorAdjust,
    file,
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
    studioOutputs,
    setStudioOutputs,
    hubQueueHydrationDone,
  } = useCarouselWorkspace();

  const activeQueueItem = queue.find((q) => q.id === activeQueueId);
  const activeItemProcessing = activeQueueItem?.status === "processing";
  const queueHasActiveWork = queue.some(
    (q) => q.status === "processing" || q.status === "pending"
  );

  const [mobileClient, setMobileClient] = useState(false);
  useEffect(() => {
    setMobileClient(isMobileClient());
  }, []);

  const carouselColorPreviewFilter = useMemo(
    () => frameColorAdjustToCssFilter(frameColorAdjust),
    [frameColorAdjust]
  );

  const [studioTab, setStudioTab] = useState<StudioTab>("carousel");
  const [previewPlatform, setPreviewPlatform] =
    useState<CarouselPreviewPlatform>("youtube");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [metaConfigured, setMetaConfigured] = useState<boolean | null>(null);
  const [youtubeConfigured, setYoutubeConfigured] = useState<boolean | null>(
    null
  );
  const [metaPublishLimitSummary, setMetaPublishLimitSummary] = useState<
    string | null
  >(null);
  const [scheduleCaption, setScheduleCaption] = useState("");
  const [postToInstagram, setPostToInstagram] = useState(true);
  const [postToFacebook, setPostToFacebook] = useState(true);
  const [postToYouTube, setPostToYouTube] = useState(true);
  const [scheduleLocal, setScheduleLocal] = useState("");
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishFeedback, setPublishFeedback] = useState<string | null>(null);
  const [metaPublishKind, setMetaPublishKind] =
    useState<MetaPublishContentKind>("carousel");
  const [metaVerifyBusy, setMetaVerifyBusy] = useState(false);
  const [metaVerifyResult, setMetaVerifyResult] = useState<string | null>(null);
  const [videoToShortWarning, setVideoToShortWarning] = useState<string | null>(
    null
  );
  const videoUploadInputId = useId();
  const carouselFocusFieldId = useId();
  const carouselSocialCaptionFieldId = useId();

  const [carouselFocusDraft, setCarouselFocusDraft] = useState("");

  useEffect(() => {
    setCarouselFocusDraft(getCarouselFocusFromStorage());
  }, []);

  const onCarouselFocusChange = useCallback((value: string) => {
    const v = value.slice(0, MAX_CAROUSEL_FOCUS_CHARS);
    setCarouselFocusDraft(v);
    setCarouselFocusToStorage(v);
  }, []);

  useEffect(() => {
    setPreviewPlatform("youtube");
  }, [activeQueueId]);

  useEffect(() => {
    if (scheduleOpen) setMetaVerifyResult(null);
  }, [scheduleOpen]);

  /** Queue row finished (includes carousel-only, short-only, or any mix of outputs). */
  const hasProcessed = activeQueueItem?.status === "done";
  const hasShortOutput = Boolean(
    hasProcessed && (shortOutputFile || reelMp4Url)
  );

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

  /** Short tab: separate reel file, or editorial metadata-only row (rare). */
  const shortOutputTabVisible = useMemo(
    () =>
      hasShortOutput ||
      showShortEditorialReport ||
      Boolean(shortJobId && hasProcessed) ||
      Boolean(shortError && hasProcessed),
    [
      hasShortOutput,
      showShortEditorialReport,
      shortJobId,
      hasProcessed,
      shortError,
    ]
  );

  const effectiveStudioTab = useMemo((): StudioTab => {
    if (studioTab === "short" && !shortOutputTabVisible) return "carousel";
    if (studioTab === "social" && !X_THREADS_OUTPUT_ENABLED) return "carousel";
    return studioTab;
  }, [studioTab, shortOutputTabVisible]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(clientApiPath("/api/video-to-short/status"));
        if (cancelled) return;
        if (!res.ok) {
          if (!cancelled) setVideoToShortWarning(null);
          return;
        }
        let data: {
          integrationEnabled?: boolean;
          clientSkipsShort?: boolean;
          apiBase?: string;
          backendReachable?: boolean | null;
        };
        try {
          data = (await res.json()) as typeof data;
        } catch {
          if (!cancelled) setVideoToShortWarning(null);
          return;
        }
        if (cancelled) return;

        if (data.clientSkipsShort) {
          setVideoToShortWarning(
            "NEXT_PUBLIC_SKIP_VIDEO_TO_SHORT is set, so this app will not call the Short backend—the original upload is used for the Short step. Carousel and image post are unchanged."
          );
          return;
        }
        if (data.integrationEnabled === false) {
          setVideoToShortWarning(
            "Video to Short integration is turned off (VIDEO_TO_SHORT_INTEGRATION). The queue will use your original file for the Short step instead of the external backend."
          );
          return;
        }
        if (data.backendReachable === false) {
          const where = data.apiBase?.trim() || "the configured URL";
          setVideoToShortWarning(
            `The Video to Short backend does not appear to be running (could not reach ${where}). Start it (e.g. FastAPI / uvicorn) or set VIDEO_TO_SHORT_API_URL in .env.local. Carousel and image post still work.`
          );
          return;
        }
        setVideoToShortWarning(null);
      } catch {
        if (!cancelled) setVideoToShortWarning(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pick up a stitched MP4 handed over from /stitch.
  //
  // v2 (mobile-resilient) flow — addresses two failure modes from the v1
  // consume-and-delete approach:
  //   1. Phone tab suspended mid-processing → IDB record deleted → user
  //      reloads to retry, but file is gone. v2 keeps the file in IDB
  //      until the queue item lands in a terminal success state.
  //   2. React StrictMode + reloads cause repeat enqueueing of the same
  //      file. v2 dedupes by stashing the file's createdAt in
  //      sessionStorage; if we already enqueued this exact stash, skip.
  //
  // The cleanup useEffect below watches the queue and clears the IDB
  // record once a queue item reaches "completed". On failure we leave
  // the file so the user can refresh and retry.
  const [stitchedHandoffActive, setStitchedHandoffActive] = useState(false);
  const [handoffQueueIds, setHandoffQueueIds] = useState<string[]>([]);
  useEffect(() => {
    if (!hubQueueHydrationDone) return;
    let cancelled = false;
    let claimedCreatedAt: number | null = null;
    (async () => {
      const peeked = await peekStitchedFiles();
      if (!peeked || cancelled) return;
      // Stitch may target Video Editor instead of Multiplier.
      if (peeked.destination === "video-editor") return;
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
      const newIds = enqueueFiles(filesToEnqueue, {
        aiInstructionsByIndex: notes,
      });
      setShortSourceTool("multiplier");
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
  }, [enqueueFiles, queue, removeQueueItem, hubQueueHydrationDone]);

  // Clear IndexedDB only after every handoff queue row reaches "done".
  useEffect(() => {
    if (!stitchedHandoffActive) return;
    if (!stitchHandoffBatchFullyDone(queue, handoffQueueIds)) return;
    void clearStitchedFile();
    setStitchedHandoffActive(false);
    setHandoffQueueIds([]);
  }, [queue, stitchedHandoffActive, handoffQueueIds]);

  // Mobile-resilient Short job recovery. If the tab was suspended/refreshed
  // while a Short was in flight, the backend likely still finished the job —
  // we just lost the poll loop. localStorage persists the jobId across that
  // gap so we can offer to download the result without re-uploading.
  const [inFlightShortJob, setInFlightShortJob] =
    useState<InFlightShortJob | null>(null);
  const [recoveringShort, setRecoveringShort] = useState(false);
  const [recoverShortError, setRecoverShortError] = useState<string | null>(
    null
  );
  useEffect(() => {
    // Only check on mount; the run flow itself manages these entries while polling.
    let cancelled = false;
    (async () => {
      // Path A: in-flight jobId persisted (upload returned successfully, poll loop died).
      const record = readInFlightShortJob();
      if (record) {
        if (!cancelled) setInFlightShortJob(record);
        return;
      }
      // Path B: orphaned pre-upload correlation id (upload response itself was
      // lost — tab backgrounded mid-fetch — so no jobId reached the client).
      // Ask the backend whether a job exists for this correlation id; if yes,
      // promote it to an in-flight record and surface the recovery banner.
      const orphan = readPreUploadCorrelation();
      if (!orphan) return;
      try {
        const lookup = await lookupShortJobByCorrelationId(orphan.correlationId);
        if (cancelled) return;
        if (!lookup) {
          // No job exists for this correlation. Either the upload never
          // reached the backend, or the job is past TTL on the server side.
          // Drop the orphan so we don't keep retrying it on every mount.
          clearPreUploadCorrelation();
          return;
        }
        // Promote to in-flight record and clear the correlation entry — the
        // jobId is now the canonical handle.
        setInFlightShortJob({
          jobId: lookup.jobId,
          createdAt: orphan.createdAt,
          sourceName: orphan.sourceName,
        });
        clearPreUploadCorrelation();
      } catch {
        // Network blip — leave the orphan; we'll retry on next mount.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleDismissInFlightShort = useCallback(() => {
    clearInFlightShortJob();
    setInFlightShortJob(null);
    setRecoverShortError(null);
  }, []);
  const handleRecoverInFlightShort = useCallback(async () => {
    if (!inFlightShortJob) return;
    setRecoveringShort(true);
    setRecoverShortError(null);
    try {
      await recoverInFlightShortForQueue(inFlightShortJob);
      setInFlightShortJob(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Recovery failed";
      setRecoverShortError(msg);
    } finally {
      setRecoveringShort(false);
    }
  }, [inFlightShortJob, recoverInFlightShortForQueue]);

  /** Stream preview from the Short backend when the MP4 is not in memory yet. */
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
    const jobId = shortJobId?.trim();
    const remote = reelMp4Url?.trim();
    // Fresh Short-job output while re-processing (CDN may still be the old reel).
    if (jobId && shortJobPreviewEligible && shortReprocessBusy) {
      setShortPreviewUrl(shortJobDownloadApiUrl(jobId));
      return;
    }
    // Prefer Bunny CDN (faststart proxy) over local blobs — local MP4s often
    // still have moov-at-end and fail on iPhone Safari even when size > 0.
    if (remote) {
      setShortPreviewUrl(mobileFriendlyMp4PreviewUrl(remote));
      return;
    }
    if (shortOutputFile && shortOutputFile.size > 0) {
      const url = URL.createObjectURL(shortOutputFile);
      setShortPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
    if (jobId && shortJobPreviewEligible) {
      setShortPreviewUrl(shortJobDownloadApiUrl(jobId));
      return;
    }
    setShortPreviewUrl(null);
  }, [
    shortOutputFile,
    hasProcessed,
    reelMp4Url,
    shortJobId,
    shortJobPreviewEligible,
    shortReprocessBusy,
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
      a.rel = "noopener";
      a.click();
      return;
    }
    const jobId = shortJobId?.trim();
    if (jobId) {
      const a = document.createElement("a");
      a.href = shortJobDownloadApiUrl(jobId);
      a.download = "short.mp4";
      a.rel = "noopener";
      a.click();
    }
  }, [shortOutputFile, reelMp4Url, shortJobId]);

  const youtubeSlides = useMemo(
    () => slidePreviewBase64s ?? [],
    [slidePreviewBase64s]
  );
  const instagramSlides = useMemo(
    () => slidePreviewBase64sInstagram ?? [],
    [slidePreviewBase64sInstagram]
  );

  const slidesForMeta = useMemo(() => {
    const igOk = instagramSlides.length > 0 ? instagramSlides : null;
    const ytOk = youtubeSlides.length > 0 ? youtubeSlides : null;
    if (postToInstagram && postToFacebook) {
      // Prefer 4:5 for both; if this ZIP has no instagram_4x5 folder, use 1:1 so publish is not blocked.
      return igOk ?? ytOk ?? [];
    }
    if (postToInstagram) return instagramSlides;
    return igOk ?? ytOk ?? [];
  }, [
    postToInstagram,
    postToFacebook,
    instagramSlides,
    youtubeSlides,
  ]);

  const photoSlidesForMeta = useMemo(() => {
    const b64 = imagePost?.imageBase64;
    return typeof b64 === "string" && b64.length > 0 ? [b64] : [];
  }, [imagePost?.imageBase64]);

  const wantsMetaDestinations = postToInstagram || postToFacebook;
  const wantsYouTube =
    postToYouTube &&
    metaPublishKind === "short" &&
    Boolean(shortOutputFile);

  const publishContentReady =
    metaPublishKind === "carousel"
      ? slidesForMeta.length > 0
      : metaPublishKind === "photo"
        ? photoSlidesForMeta.length > 0
        : Boolean(shortOutputFile);

  const metaDestinationsOk = !wantsMetaDestinations || metaConfigured === true;
  const youtubeDestinationOk = !wantsYouTube || youtubeConfigured === true;
  const hasAnyPublishDestination =
    wantsMetaDestinations || wantsYouTube;

  const publishConfigLoading =
    scheduleOpen &&
    (metaConfigured === null || youtubeConfigured === null);

  const canSubmitPublish =
    scheduleOpen &&
    !publishConfigLoading &&
    hasAnyPublishDestination &&
    metaDestinationsOk &&
    youtubeDestinationOk &&
    publishContentReady;

  useEffect(() => {
    if (!scheduleOpen) return;
    setPublishFeedback(null);
    setMetaPublishLimitSummary(null);
    const fromSlides = editableSlides
      .map((s) => s.headline.trim())
      .filter(Boolean)
      .join("\n\n");
    const cap =
      socialCaption.trim().length > 0 ? socialCaption.trim() : fromSlides;
    let initialKind: MetaPublishContentKind = "carousel";
    if (effectiveStudioTab === "image" && imagePost?.imageBase64) {
      initialKind = "photo";
    } else if (effectiveStudioTab === "short" && shortOutputFile) {
      initialKind = "short";
    }
    setMetaPublishKind(initialKind);
    const carouselMetaSupported =
      initialKind !== "carousel" ||
      instagramSlides.length > 0 ||
      youtubeSlides.length > 0;
    setPostToInstagram(carouselMetaSupported);
    setPostToFacebook(carouselMetaSupported);
    setPostToYouTube(false);
    if (initialKind === "photo") {
      setScheduleCaption(imagePost?.caption?.trim() || cap);
    } else if (initialKind === "short") {
      setScheduleCaption(socialCaption.trim() || cap);
    } else {
      setScheduleCaption(cap);
    }
    let cancelled = false;
    (async () => {
      try {
        const [metaRes, ytRes] = await Promise.all([
          fetch(clientApiPath("/api/integrations/meta/status")),
          fetch(clientApiPath("/api/integrations/youtube/status")),
        ]);
        const metaRaw = await metaRes.text();
        let metaConfiguredVal = false;
        let metaLimit: string | null = null;
        try {
          const metaData = metaRaw
            ? (JSON.parse(metaRaw) as {
                configured?: boolean;
                publishLimitSummary?: string;
              })
            : {};
          metaConfiguredVal = !!metaData.configured;
          metaLimit =
            metaData.configured &&
            typeof metaData.publishLimitSummary === "string"
              ? metaData.publishLimitSummary
              : null;
        } catch {
          metaConfiguredVal = false;
          metaLimit = null;
        }
        let ytConfigured = false;
        try {
          const ytData = (await ytRes.json()) as { configured?: boolean };
          ytConfigured = !!ytData.configured;
        } catch {
          ytConfigured = false;
        }
        if (!cancelled) {
          setMetaConfigured(metaConfiguredVal);
          setMetaPublishLimitSummary(metaLimit);
          setYoutubeConfigured(ytConfigured);
          if (initialKind === "short") {
            setPostToYouTube(ytConfigured);
          }
        }
      } catch {
        if (!cancelled) {
          setMetaConfigured(false);
          setMetaPublishLimitSummary(null);
          setYoutubeConfigured(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed dialog only when it opens or queue/tab/assets change; socialCaption/editableSlides would reset the user's caption while typing.
  }, [
    scheduleOpen,
    activeQueueId,
    studioTab,
    effectiveStudioTab,
    imagePost?.imageBase64,
    imagePost?.caption,
    shortOutputFile,
    instagramSlides.length,
    youtubeSlides.length,
  ]);

  const seedCaptionForMetaKind = useCallback(
    (kind: MetaPublishContentKind) => {
      const fromSlides = editableSlides
        .map((s) => s.headline.trim())
        .filter(Boolean)
        .join("\n\n");
      const cap =
        socialCaption.trim().length > 0 ? socialCaption.trim() : fromSlides;
      setMetaPublishKind(kind);
      if (kind === "carousel") {
        const any =
          instagramSlides.length > 0 || youtubeSlides.length > 0;
        setPostToInstagram(any);
        setPostToFacebook(any);
      } else {
        setPostToInstagram(true);
        setPostToFacebook(true);
      }
      setPostToYouTube(kind === "short" && youtubeConfigured === true);
      if (kind === "photo") {
        setScheduleCaption(imagePost?.caption?.trim() || cap);
      } else if (kind === "short") {
        setScheduleCaption(socialCaption.trim() || cap);
      } else {
        setScheduleCaption(cap);
      }
    },
    [
      editableSlides,
      socialCaption,
      imagePost?.caption,
      youtubeConfigured,
      instagramSlides.length,
      youtubeSlides.length,
    ]
  );

  const runMetaConnectionVerify = useCallback(async () => {
    setMetaVerifyBusy(true);
    setMetaVerifyResult(null);
    try {
      const res = await fetch(clientApiPath("/api/integrations/meta/verify"));
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        fbtrace_id?: string;
        pageName?: string;
        instagramUsername?: string;
        instagramBusinessAccountId?: string;
      };
      if (data.ok) {
        const parts = [`Page: ${data.pageName ?? "OK"}`];
        if (data.instagramBusinessAccountId) {
          parts.push(
            data.instagramUsername
              ? `Instagram @${data.instagramUsername} linked`
              : `Instagram account ${data.instagramBusinessAccountId} linked`
          );
        } else {
          parts.push(
            "No Instagram professional account linked to this Page (IG publish will fail until you link one)."
          );
        }
        setMetaVerifyResult(parts.join(" · "));
      } else {
        setMetaVerifyResult(
          `${data.message ?? "Verification failed"}${
            data.fbtrace_id ? ` · Meta trace id: ${data.fbtrace_id}` : ""
          }`
        );
      }
    } catch {
      setMetaVerifyResult("Network error while verifying Meta.");
    } finally {
      setMetaVerifyBusy(false);
    }
  }, []);

  const handleMetaPublish = useCallback(async () => {
    if (!canSubmitPublish || publishLoading) return;
    setPublishLoading(true);
    setPublishFeedback(null);
    try {
      const scheduledPublishTime =
        scheduleLocal.trim() === ""
          ? undefined
          : Math.floor(new Date(scheduleLocal).getTime() / 1000);
      const scheduledOk =
        scheduledPublishTime &&
        Number.isFinite(scheduledPublishTime) &&
        scheduledPublishTime > 0
          ? scheduledPublishTime
          : undefined;

      const wantsMeta = postToInstagram || postToFacebook;
      const wantsYt =
        postToYouTube &&
        metaPublishKind === "short" &&
        Boolean(shortOutputFile) &&
        youtubeConfigured === true;

      const okParts: string[] = [];
      const errParts: string[] = [];

      if (wantsMeta) {
        try {
          let metaRes: Response | null = null;
          if (metaPublishKind === "short") {
            if (!shortOutputFile) {
              errParts.push("Meta: no Short MP4.");
            } else {
              metaRes = await postMetaReelPublish({
                video: shortOutputFile,
                caption: scheduleCaption,
                publishInstagram: postToInstagram,
                publishFacebook: postToFacebook,
                scheduledPublishTime: scheduledOk,
              });
            }
          } else if (metaPublishKind === "photo") {
            if (photoSlidesForMeta.length === 0) {
              errParts.push("Meta: no photo image to publish.");
            } else {
              metaRes = await postMetaCarouselPublish({
                caption: scheduleCaption,
                publishInstagram: postToInstagram,
                publishFacebook: postToFacebook,
                scheduledPublishTime: scheduledOk,
                slidesBase64: photoSlidesForMeta,
              });
            }
          } else {
            const flushed = flushActiveQueueSnapshot();
            if (!flushed) {
              errParts.push(
                "Meta: no video selected — open a completed item in the queue first."
              );
            } else {
              const slidesBase64 = await slidesForMetaFromZipOrSnapshot(
                flushed,
                postToInstagram,
                postToFacebook
              );
              if (slidesBase64.length === 0) {
                errParts.push(
                  "Meta: no slide images to publish. Generate the carousel first."
                );
              } else {
                metaRes = await postMetaCarouselPublish({
                  caption: scheduleCaption,
                  publishInstagram: postToInstagram,
                  publishFacebook: postToFacebook,
                  scheduledPublishTime: scheduledOk,
                  slidesBase64,
                });
              }
            }
          }

          if (metaRes) {
            const raw = await metaRes.text();
            let data: {
              error?: string;
              instagramMediaId?: string;
              facebookPostId?: string;
              facebookVideoId?: string;
            } = {};
            try {
              data = raw ? (JSON.parse(raw) as typeof data) : {};
            } catch {
              errParts.push(
                `Meta: bad response (${metaRes.status}). Check the Network tab.`
              );
            }
            if (errParts.length === 0) {
              if (!metaRes.ok) {
                errParts.push(data.error ?? `Meta failed (${metaRes.status}).`);
              } else {
                if (data.instagramMediaId) {
                  okParts.push(`Instagram ${data.instagramMediaId}`);
                }
                const fbId = data.facebookPostId ?? data.facebookVideoId;
                if (fbId) okParts.push(`Facebook ${fbId}`);
              }
            }
          }
        } catch (e) {
          errParts.push(
            `Meta: ${e instanceof Error ? e.message : "Could not start publish upload."}`
          );
        }
      }

      if (wantsYt && shortOutputFile) {
        try {
          const ytRes = await postYoutubeShortPublish({
            video: shortOutputFile,
            caption: scheduleCaption,
            scheduledPublishTime: scheduledOk,
          });
          const ytRaw = await ytRes.text();
          let ytData: { error?: string; youtubeVideoId?: string };
          try {
            ytData = ytRaw ? (JSON.parse(ytRaw) as typeof ytData) : {};
          } catch {
            errParts.push(
              `YouTube: invalid JSON (${ytRes.status}). Check the server log.`
            );
            ytData = {};
          }
          if (!ytRes.ok) {
            errParts.push(ytData.error ?? `YouTube failed (${ytRes.status}).`);
          } else if (ytData.youtubeVideoId) {
            okParts.push(`YouTube ${ytData.youtubeVideoId}`);
          } else {
            okParts.push("YouTube OK");
          }
        } catch (e) {
          errParts.push(
            `YouTube: ${e instanceof Error ? e.message : "Upload request failed."}`
          );
        }
      }

      if (errParts.length > 0 && okParts.length === 0) {
        setPublishFeedback(errParts.join(" · "));
      } else if (errParts.length > 0) {
        setPublishFeedback(
          `Partial: ${okParts.join(" · ")} · ${errParts.join(" · ")}`
        );
      } else {
        setPublishFeedback(
          okParts.length > 0 ? `Published: ${okParts.join(" · ")}` : "Done."
        );
      }
    } catch (e) {
      setPublishFeedback(
        e instanceof Error ? e.message : "Network error while publishing."
      );
    } finally {
      setPublishLoading(false);
    }
  }, [
    canSubmitPublish,
    publishLoading,
    scheduleCaption,
    photoSlidesForMeta,
    metaPublishKind,
    shortOutputFile,
    postToInstagram,
    postToFacebook,
    postToYouTube,
    youtubeConfigured,
    scheduleLocal,
    flushActiveQueueSnapshot,
  ]);

  useEffect(() => {
    if (
      previewPlatform === "instagram" &&
      instagramSlides.length === 0 &&
      youtubeSlides.length > 0
    ) {
      setPreviewPlatform("youtube");
    }
  }, [
    previewPlatform,
    instagramSlides.length,
    youtubeSlides.length,
  ]);

  const previewImages =
    previewPlatform === "youtube" ? youtubeSlides : instagramSlides;
  const hasInstagramPreview = instagramSlides.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 pb-24">
      {error && (
        <p className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {mobileClient ? (
        <p
          className={`mb-6 rounded-lg border px-3 py-2 text-sm leading-relaxed ${
            loading || queueHasActiveWork
              ? "border-violet-200 bg-violet-50 text-violet-950"
              : "border-stone-200 bg-stone-50 text-stone-600"
          }`}
          role="status"
        >
          {loading || queueHasActiveWork ? (
            <>
              <span className="font-semibold">Phone tip: </span>
              Keep this tab open and the screen on until processing finishes.
              Wi‑Fi works best. Uploads run one at a time on mobile for
              reliability — slower than desktop, but much less likely to fail.
            </>
          ) : (
            <>
              <span className="font-semibold text-stone-800">On iPhone: </span>
              use Wi‑Fi, keep Safari in the foreground, and uncheck output
              formats you don&apos;t need before uploading.
            </>
          )}
        </p>
      ) : null}

      {inFlightShortJob && (
        <div
          className="mb-6 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm leading-relaxed text-sky-950"
          role="status"
        >
          <p className="mb-2">
            <span className="font-semibold">In-flight Short found: </span>
            looks like a Short was processing for{" "}
            <span className="font-medium">
              {inFlightShortJob.sourceName}
            </span>{" "}
            when this tab last closed. The server has likely finished — attach
            it to this upload?
          </p>
          {recoverShortError && (
            <p className="mb-2 text-xs text-red-700">{recoverShortError}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleRecoverInFlightShort()}
              disabled={recoveringShort}
              className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {recoveringShort ? "Recovering…" : "Load Short into studio"}
            </button>
            <button
              type="button"
              onClick={handleDismissInFlightShort}
              disabled={recoveringShort}
              className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {videoToShortWarning && (
        <p
          className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-950"
          role="status"
        >
          <span className="font-semibold">Video to Short: </span>
          {videoToShortWarning}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-3 lg:gap-8">
        <div className="min-w-0 space-y-3 lg:col-span-1">
          <details className="group rounded-2xl border border-stone-200/80 bg-white text-left shadow-sm [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-stone-900 marker:content-none hover:bg-stone-50/80">
              <span>Output formats</span>
              <span
                className="shrink-0 text-stone-400 transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              >
                ▼
              </span>
            </summary>
            <div
              className="space-y-2.5 border-t border-stone-100 px-4 pb-4 pt-2"
              onClick={(e) => e.stopPropagation()}
            >
              <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-800">
                <input
                  type="checkbox"
                  checked={studioOutputs.carousel}
                  onChange={(e) =>
                    setStudioOutputs((s) => ({
                      ...s,
                      carousel: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-stone-300 text-palette-moss focus:ring-palette-teal"
                />
                <span>Carousel</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-800">
                <input
                  type="checkbox"
                  checked={studioOutputs.imagePost}
                  onChange={(e) =>
                    setStudioOutputs((s) => ({
                      ...s,
                      imagePost: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-stone-300 text-palette-moss focus:ring-palette-teal"
                />
                <span>Image post (4:5)</span>
              </label>
              {X_THREADS_OUTPUT_ENABLED ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-800">
                  <input
                    type="checkbox"
                    checked={studioOutputs.xPost}
                    onChange={(e) =>
                      setStudioOutputs((s) => ({ ...s, xPost: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-stone-300 text-palette-moss focus:ring-palette-teal"
                  />
                  <span>X / Threads post</span>
                </label>
              ) : null}
              <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-800">
                <input
                  type="checkbox"
                  checked={studioOutputs.reelShort}
                  onChange={(e) =>
                    setStudioOutputs((s) => ({
                      ...s,
                      reelShort: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-stone-300 text-palette-moss focus:ring-palette-teal"
                />
                <span>Reel (Video to Short)</span>
              </label>
            </div>
          </details>

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
            <div
              className="border-t border-stone-100 px-4 pb-4 pt-2"
              onClick={(e) => e.stopPropagation()}
            >
              <label htmlFor={carouselFocusFieldId} className="sr-only">
                Studio run notes for the AI (optional)
              </label>
              <textarea
                id={carouselFocusFieldId}
                value={carouselFocusDraft}
                onChange={(e) => onCarouselFocusChange(e.target.value)}
                rows={6}
                maxLength={MAX_CAROUSEL_FOCUS_CHARS}
                placeholder={`e.g. "Carousel: land on [topic] — tie to transcript at ~0:45."\nPhoto: punchy hook + soft CTA.\nX: 4 tweets, no hashtags.\nThreads: mirror X but warmer.\nReel: keep energy high, no new claims."`}
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
            onEnqueueFiles={(files) => {
              setShortSourceTool("multiplier");
              enqueueFiles(files);
            }}
            disabled={queue.some((q) => q.status === "processing")}
          />

          <div className="flex flex-col items-center text-center rounded-2xl border-2 border-dashed border-palette-sage bg-white p-4 shadow-md shadow-stone-200/50">
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
                  setShortSourceTool("multiplier");
                  enqueueFiles(Array.from(list));
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
          </div>

          <div className="mx-auto w-full max-w-full space-y-3 lg:max-w-none">
            {queue.length > 0 ? (
              <div className="max-h-[min(52vh,22rem)] space-y-3 overflow-y-auto pr-0.5">
                {queue.map((item) => {
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
                          {item.status === "done" ||
                          item.status === "error" ||
                          item.status === "processing" ||
                          item.status === "pending" ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeQueueItem(item.id);
                              }}
                              aria-label={
                                item.status === "processing"
                                  ? `Cancel processing and remove ${queueItemDisplayLabel(item)} from queue`
                                  : `Remove ${queueItemDisplayLabel(item)} from queue`
                              }
                              title={
                                item.status === "processing"
                                  ? "Cancel and remove"
                                  : "Remove from queue"
                              }
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-sm leading-none text-stone-400 transition hover:bg-stone-200/80 hover:text-stone-700"
                            >
                              ×
                            </button>
                          ) : null}
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
            ) : null}
            {canDownloadAllZips ? (
              <button
                type="button"
                onClick={() => void downloadAllZips()}
                disabled={downloadAllZipsLoading}
                className="w-full rounded-xl border-2 border-palette-moss bg-white py-3 text-sm font-semibold text-palette-moss transition hover:bg-palette-pale/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {downloadAllZipsLoading
                  ? "Preparing download…"
                  : "Download all carousels (zip)"}
              </button>
            ) : null}
            {queue.length === 0 ? (
              <div className="space-y-3" aria-hidden>
                {Array.from({ length: 4 }, (_, i) => (
                  <div
                    key={i}
                    className="h-12 w-full rounded-2xl border border-stone-200 bg-stone-100/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.8)]"
                  />
                ))}
              </div>
            ) : null}
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
              <span className="sr-only">
                {activeQueueItem?.progress
                  ? `Processing: ${activeQueueItem.progress}`
                  : "Processing video, please wait."}
              </span>
              <div
                className="mb-5 h-14 w-14 rounded-full border-[3px] border-palette-pale/80 border-t-palette-depth animate-spin"
                aria-hidden
              />
              <p className="text-base font-medium text-stone-800">
                {activeQueueItem?.progress ?? "Creating your posts"}
              </p>
              <p className="mt-2 max-w-md text-sm text-stone-600">
                {activeQueueItem?.progress
                  ? "Video to Short, carousel, and image post run in parallel when enabled — this line updates as each step advances."
                  : "Starting pipeline…"}
              </p>
              {studioOutputs.reelShort ||
              studioOutputs.carousel ||
              studioOutputs.imagePost ||
              (X_THREADS_OUTPUT_ENABLED && studioOutputs.xPost) ? (
                <ul className="mt-5 max-w-sm space-y-1.5 text-left text-xs text-stone-500">
                  {studioOutputs.reelShort ? (
                    <li>
                      <span className="font-medium text-stone-700">Short video</span>
                      {activeQueueItem?.progress?.toLowerCase().includes("short") ||
                      activeQueueItem?.progress?.toLowerCase().includes("video to short")
                        ? " — in progress"
                        : activeQueueItem?.progress?.includes("Generating")
                          ? " — queued"
                          : ""}
                    </li>
                  ) : null}
                  {studioOutputs.carousel ? (
                    <li>
                      <span className="font-medium text-stone-700">Carousel</span>
                      {activeQueueItem?.progress?.toLowerCase().includes("carousel")
                        ? " — in progress"
                        : activeQueueItem?.progress?.includes("Generating")
                          ? " — queued"
                          : ""}
                    </li>
                  ) : null}
                  {studioOutputs.imagePost ? (
                    <li>
                      <span className="font-medium text-stone-700">Image post</span>
                      {activeQueueItem?.progress?.toLowerCase().includes("image post")
                        ? " — in progress"
                        : activeQueueItem?.progress?.includes("Generating")
                          ? " — queued"
                          : ""}
                    </li>
                  ) : null}
                  {X_THREADS_OUTPUT_ENABLED && studioOutputs.xPost ? (
                    <li>
                      <span className="font-medium text-stone-700">X / Threads</span>
                      {activeQueueItem?.progress?.toLowerCase().includes("x/threads")
                        ? " — in progress"
                        : activeQueueItem?.progress?.includes("Generating")
                          ? " — queued"
                          : ""}
                    </li>
                  ) : null}
                </ul>
              ) : null}
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
                Nothing generated yet
              </p>
              <p className="mt-2 max-w-sm text-sm text-stone-600">
                Upload a video to generate your high-converting content
              </p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-6">
              <div
                className="flex shrink-0 rounded-lg border border-stone-200 bg-stone-50 p-0.5 text-xs font-semibold shadow-sm"
                role="tablist"
                aria-label="Output type"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveStudioTab === "carousel"}
                  onClick={() => setStudioTab("carousel")}
                  className={`min-w-0 flex-1 rounded-md px-2 py-2 transition sm:px-2.5 ${
                    effectiveStudioTab === "carousel"
                      ? "bg-white text-palette-depth shadow-sm"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  Carousel
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveStudioTab === "image"}
                  onClick={() => setStudioTab("image")}
                  className={`min-w-0 flex-1 rounded-md px-2 py-2 transition sm:px-2.5 ${
                    effectiveStudioTab === "image"
                      ? "bg-white text-palette-depth shadow-sm"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  Image post
                </button>
                {X_THREADS_OUTPUT_ENABLED ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={effectiveStudioTab === "social"}
                    onClick={() => setStudioTab("social")}
                    className={`min-w-0 flex-1 rounded-md px-2 py-2 transition sm:px-2.5 ${
                      effectiveStudioTab === "social"
                        ? "bg-white text-palette-depth shadow-sm"
                        : "text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    X / Threads
                  </button>
                ) : null}
                {shortOutputTabVisible ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={effectiveStudioTab === "short"}
                    onClick={() => setStudioTab("short")}
                    className={`min-w-0 flex-1 rounded-md px-2 py-2 transition sm:px-2.5 ${
                      effectiveStudioTab === "short"
                        ? "bg-white text-palette-depth shadow-sm"
                        : "text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    Short
                  </button>
                ) : null}
              </div>

              {shortReprocessBusy && effectiveStudioTab !== "short" ? (
                <p
                  className="mb-3 shrink-0 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-950"
                  role="status"
                  aria-live="polite"
                >
                  <span className="font-semibold">Short is re-processing</span>{" "}
                  in the background. You can keep working on the carousel
                  {X_THREADS_OUTPUT_ENABLED ? ", image post, or X / Threads tab" : " or image post tab"}
                  ; open the{" "}
                  <button
                    type="button"
                    className="font-semibold text-palette-depth underline decoration-palette-depth/40 underline-offset-2 hover:text-stone-900"
                    onClick={() => setStudioTab("short")}
                  >
                    Short
                  </button>{" "}
                  tab to watch progress.
                </p>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {effectiveStudioTab === "carousel" ? (
                  <div className="space-y-6">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-lg font-medium text-stone-900">
                        Preview
                      </h2>
                      {(youtubeSlides.length > 0 || hasInstagramPreview) && (
                        <div
                          className="flex shrink-0 rounded-lg border border-stone-200 bg-stone-50 p-0.5 text-xs font-semibold shadow-sm"
                          role="group"
                          aria-label="Carousel aspect"
                        >
                          <button
                            type="button"
                            onClick={() => setPreviewPlatform("youtube")}
                            aria-pressed={previewPlatform === "youtube"}
                            className={`rounded-md px-2.5 py-1.5 transition ${
                              previewPlatform === "youtube"
                                ? "bg-white text-palette-depth shadow-sm"
                                : "text-stone-600 hover:text-stone-900"
                            }`}
                          >
                            YouTube
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewPlatform("instagram")}
                            disabled={!hasInstagramPreview}
                            aria-pressed={previewPlatform === "instagram"}
                            title={
                              hasInstagramPreview
                                ? "1080×1350 (4:5) carousel"
                                : "Instagram-size previews unavailable"
                            }
                            className={`rounded-md px-2.5 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                              previewPlatform === "instagram"
                                ? "bg-white text-palette-depth shadow-sm"
                                : "text-stone-600 hover:text-stone-900"
                            }`}
                          >
                            Instagram
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="relative flex flex-col items-center">
                      {reRenderLoading ? (
                        <div
                          className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-white/85 px-4 text-center backdrop-blur-[2px]"
                          role="status"
                          aria-live="polite"
                        >
                          <div
                            className="mb-3 h-10 w-10 rounded-full border-[3px] border-palette-pale/80 border-t-palette-depth animate-spin"
                            aria-hidden
                          />
                          <p className="text-sm font-medium text-stone-800">
                            Updating carousel
                          </p>
                          <p className="mt-1 max-w-xs text-xs text-stone-600">
                            {reRenderProgress ??
                              "Your preview will refresh when it\u2019s ready."}
                          </p>
                        </div>
                      ) : null}
                      {previewImages.length > 0 ? (
                        <CarouselSlideViewer
                          slideBase64s={previewImages}
                          previewPlatform={previewPlatform}
                          colorPreviewFilter={carouselColorPreviewFilter}
                        />
                      ) : (
                        <p className="text-sm text-stone-600">
                          Preparing previews…
                        </p>
                      )}
                    </div>
                    <CollapsibleSection title="Frame color">
                      <FrameColorAdjustSliders
                        idPrefix="home-carousel"
                        value={frameColorAdjust}
                        onChange={setFrameColorAdjust}
                        disabled={
                          loading || reRenderLoading || activeItemProcessing
                        }
                      />
                      <button
                        type="button"
                        onClick={() => void reRenderZip()}
                        disabled={
                          loading ||
                          reRenderLoading ||
                          activeItemProcessing ||
                          !zipBase64 ||
                          editableSlides.length === 0
                        }
                        className="mt-4 w-full rounded-xl border border-palette-teal bg-palette-pale/25 py-2.5 text-sm font-semibold text-stone-800 transition hover:bg-palette-pale/45 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {reRenderLoading
                          ? "Updating…"
                          : "Bake color into slide PNGs (ZIP)"}
                      </button>
                    </CollapsibleSection>
                    {hasProcessed ? (
                      <CollapsibleSection
                        title="Post caption"
                        defaultOpen={false}
                      >
                        <p className="text-left text-[11px] leading-snug text-stone-500">
                          AI draft for Instagram/Facebook (Know / Like / Trust).
                          Edit before publishing.
                        </p>
                        <label
                          htmlFor={carouselSocialCaptionFieldId}
                          className="sr-only"
                        >
                          Post caption
                        </label>
                        <textarea
                          id={carouselSocialCaptionFieldId}
                          value={socialCaption}
                          onChange={(e) => setSocialCaption(e.target.value)}
                          disabled={
                            loading ||
                            reRenderLoading ||
                            activeItemProcessing
                          }
                          rows={8}
                          placeholder="Caption appears here after processing…"
                          className="mt-2 w-full resize-y rounded-xl border border-stone-200 bg-stone-50/80 px-3 py-2.5 text-sm leading-relaxed text-stone-900 placeholder:text-stone-400 focus:border-palette-teal focus:outline-none focus:ring-1 focus:ring-palette-teal disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </CollapsibleSection>
                    ) : null}
                  </div>
                ) : effectiveStudioTab === "image" ? (
                  <div>
                    <h2 className="mb-4 text-lg font-medium text-stone-900">
                      Image post
                    </h2>
                    <ImagePostStudioPanel />
                  </div>
                ) : effectiveStudioTab === "social" ? (
                  <div>
                    <h2 className="mb-4 text-lg font-medium text-stone-900">
                      X / Threads
                    </h2>
                    <SocialMicroPanel />
                  </div>
                ) : effectiveStudioTab === "short" ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-medium text-stone-900">
                          Short (reel)
                        </h2>
                        <p className="mt-1 max-w-xl text-sm text-stone-600">
                          Video to Short export (captions, hook, etc.). Carousel and
                          image post use your original upload without these overlays.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={downloadShortMp4}
                        disabled={shortReprocessBusy || !shortPreviewUrl}
                        className="shrink-0 rounded-lg border border-palette-moss bg-white px-3 py-2 text-xs font-semibold text-palette-moss shadow-sm transition hover:bg-palette-pale/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Download MP4
                      </button>
                    </div>

                    {shortError ? (
                      <p
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-950"
                        role="status"
                      >
                        <span className="font-semibold">Reel: </span>
                        {shortError}
                        {inFlightShortJob &&
                        file &&
                        inFlightShortJob.sourceName === file.name ? (
                          <>
                            {" "}
                            A Short may still be running — use the recovery banner
                            at the top to load it into the studio when ready.
                          </>
                        ) : null}
                      </p>
                    ) : null}

                    <div className="relative">
                      {shortResumeBusy || shortReprocessBusy ? (
                        <div
                          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-white/80 backdrop-blur-sm"
                          role="status"
                          aria-live="polite"
                        >
                          <div
                            className="h-10 w-10 animate-spin rounded-full border-2 border-stone-200 border-t-palette-moss"
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
                      ) : shortJobId || shortError ? (
                        <p className="text-sm text-stone-600">
                          {shortResumeBusy
                            ? shortResumeMessage ||
                              "Reel is still processing on the server…"
                            : "Preparing preview…"}
                        </p>
                      ) : (
                        <p className="text-sm text-stone-600">Preparing preview…</p>
                      )}
                    </div>

                    <ShortEditPanel
                      shortJobId={shortJobId ?? null}
                      busy={shortReprocessBusy}
                      shortPreviewUrl={shortPreviewUrl}
                      onReprocess={reprocessActiveShortOutput}
                    />

                    <details
                      className={`group mx-auto w-full max-w-lg rounded-xl border text-left shadow-sm [&_summary::-webkit-details-marker]:hidden ${
                        showShortEditorialReport
                          ? shortEditorialSkip
                            ? "border-amber-200 bg-amber-50/90"
                            : "border-emerald-200/80 bg-emerald-50/40"
                          : "border-stone-200 bg-stone-50/90"
                      }`}
                      aria-label="Smart editorial report"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-stone-900 marker:content-none hover:bg-white/40">
                        <span>What smart editorial did</span>
                        <span
                          className="shrink-0 text-stone-400 transition-transform duration-200 group-open:rotate-180"
                          aria-hidden
                        >
                          ▼
                        </span>
                      </summary>
                      <div className="border-t border-stone-200/60 px-4 pb-4 pt-2">
                        <p className="text-xs leading-snug text-stone-600">
                          From your Video to Short run: how the reel was trimmed on
                          the original timeline, and why.
                        </p>
                        {showShortEditorialReport ? (
                          <>
                        {shortEditorialSkip ? (
                          <p className="mt-3 text-sm leading-relaxed text-amber-950">
                            {shortEditorialSkip === "no_openai_api_key"
                              ? "Smart editorial was skipped — OPENAI_API_KEY is not set on the Short backend. Add it in Coolify (or your host) and restart the service."
                              : shortEditorialSkip === "llm_error"
                                ? "Smart editorial was skipped — the editorial LLM call failed (check Short backend logs for the exact error)."
                                : `Smart editorial was skipped — ${shortEditorialSkip}`}
                          </p>
                        ) : shortEditorialSummary ? (
                          <div className="mt-3 rounded-lg border border-stone-200/80 bg-white/80 px-3 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                              Summary
                            </p>
                            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-stone-900">
                              {shortEditorialSummary}
                            </p>
                          </div>
                        ) : null}
                        {!shortEditorialSkip &&
                        shortEditorialCutRows.length > 0 ? (
                          <div className="mt-4">
                            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-stone-600">
                              Where it cut (source timeline)
                            </h4>
                            <ol className="mt-2 list-decimal space-y-4 pl-4 marker:font-medium marker:text-stone-500">
                              {shortEditorialCutRows.map((row, i) => (
                                <li
                                  key={i}
                                  className="pl-1 text-sm leading-relaxed text-stone-800"
                                >
                                  <p>
                                    <span className="font-semibold text-stone-900">
                                      Where:{" "}
                                    </span>
                                    <span className="font-mono text-[13px] font-medium text-stone-900">
                                      {row.timeRange}
                                    </span>
                                  </p>
                                  <p className="mt-1.5">
                                    <span className="font-semibold text-stone-900">
                                      Why it was cut:{" "}
                                    </span>
                                    {row.reason}
                                  </p>
                                  {row.snippet !== "—" ? (
                                    <p className="mt-1.5 text-stone-700">
                                      <span className="font-semibold text-stone-900">
                                        What was removed:{" "}
                                      </span>
                                      <q className="text-stone-800 not-italic">
                                        {row.snippet}
                                      </q>
                                    </p>
                                  ) : null}
                                </li>
                              ))}
                            </ol>
                          </div>
                        ) : null}
                          </>
                        ) : (
                        <p className="mt-3 text-sm leading-relaxed text-stone-700">
                          This app did not receive an editorial write-up for this job
                          (no{" "}
                          <code className="rounded bg-stone-100 px-1 text-xs">
                            editorial_summary
                          </code>
                          ,{" "}
                          <code className="rounded bg-stone-100 px-1 text-xs">
                            editorial_cuts
                          </code>
                          , or{" "}
                          <code className="rounded bg-stone-100 px-1 text-xs">
                            editorial_skip
                          </code>{" "}
                          on the Short job status, including inside{" "}
                          <code className="rounded bg-stone-100 px-1 text-xs">
                            meta
                          </code>
                          ). Your reel can still include trims and reframes; those
                          details live on the Video to Short service.
                        </p>
                        )}
                      </div>
                    </details>
                  </div>
                ) : null}
              </div>

              {effectiveStudioTab === "carousel" ? (
                <div className="shrink-0 border-t border-stone-200 pt-4">
                  <RefinePanel
                    hideZipDownload
                    collapseInAccordion
                    accordionTopSlot={
                      <div className="flex justify-end">
                        <Link
                          href="/refine"
                          className="text-xs font-medium text-palette-depth hover:text-stone-900"
                        >
                          Full-screen editor →
                        </Link>
                      </div>
                    }
                  />
                </div>
              ) : null}

              <div className="shrink-0 space-y-3 border-t border-stone-200 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Download
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={downloadZip}
                    disabled={!zipBase64}
                    className="flex-1 rounded-xl bg-palette-moss py-3 text-sm font-semibold text-white transition hover:bg-palette-depth disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Carousel (ZIP)
                  </button>
                  <button
                    type="button"
                    onClick={downloadImagePostPng}
                    disabled={!imagePost}
                    className="flex-1 rounded-xl border-2 border-palette-moss bg-white py-3 text-sm font-semibold text-palette-moss transition hover:bg-palette-pale/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Image (PNG)
                  </button>
                  {shortOutputFile ? (
                    <button
                      type="button"
                      onClick={downloadShortMp4}
                      className="flex-1 rounded-xl border-2 border-stone-300 bg-white py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-50"
                    >
                      Short (MP4)
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <Link
                    href="/schedule"
                    onClick={(e) => {
                      if (!hasProcessed) {
                        e.preventDefault();
                        return;
                      }
                      flushActiveQueueSnapshot();
                    }}
                    className={`block w-full rounded-xl bg-palette-moss py-3 text-center text-sm font-semibold text-white transition hover:bg-palette-depth ${
                      !hasProcessed ? "cursor-not-allowed opacity-50" : ""
                    }`}
                    aria-disabled={!hasProcessed}
                  >
                    Schedule on calendar
                  </Link>
                  <button
                    type="button"
                    onClick={() => setScheduleOpen(true)}
                    disabled={!hasProcessed}
                    className="w-full rounded-xl border border-stone-300 bg-stone-100 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Publish now…
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {scheduleOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-dialog-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]"
            onClick={() => setScheduleOpen(false)}
            aria-label="Close"
          />
          <div className="relative z-10 max-h-[min(90vh,640px)] w-full max-w-md overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
            <h2
              id="schedule-dialog-title"
              className="text-lg font-semibold text-stone-900"
            >
              Publish to Instagram / Facebook / YouTube
            </h2>
            {metaConfigured === false && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Add{" "}
                <code className="rounded bg-amber-100/80 px-1 text-xs">
                  META_PAGE_ACCESS_TOKEN
                </code>{" "}
                and{" "}
                <code className="rounded bg-amber-100/80 px-1 text-xs">
                  META_PAGE_ID
                </code>{" "}
                to <code className="text-xs">.env.local</code>, then restart the
                dev server.
              </p>
            )}
            {metaConfigured === null && scheduleOpen && (
              <p className="mt-2 text-sm text-stone-500">Checking Meta setup…</p>
            )}
            {metaConfigured === true && metaPublishLimitSummary && (
              <p className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
                {metaPublishLimitSummary}
              </p>
            )}
            {metaConfigured === true && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void runMetaConnectionVerify()}
                  disabled={metaVerifyBusy || publishLoading}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-50"
                >
                  {metaVerifyBusy
                    ? "Testing connection…"
                    : "Test Meta connection (no post)"}
                </button>
                {metaVerifyResult && (
                  <p
                    className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-700"
                    role="status"
                  >
                    {metaVerifyResult}
                  </p>
                )}
              </div>
            )}
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              <strong className="font-medium text-stone-800">Carousel</strong>{" "}
              sends ZIP slide previews (4:5 to Instagram when available).
              <strong className="font-medium text-stone-800"> Photo</strong> is
              the single 4:5 still from Image post.
              <strong className="font-medium text-stone-800"> Short</strong>{" "}
              uploads your Video to Short MP4 to Instagram, Facebook Page, and
              your YouTube channel (when connected). Still images use JPEG on
              the wire for Meta.
            </p>
            <div className="mt-4">
              <p className="text-sm font-medium text-stone-800">Post type</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => seedCaptionForMetaKind("carousel")}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    metaPublishKind === "carousel"
                      ? "border-palette-moss bg-palette-moss/15 text-palette-depth ring-2 ring-palette-moss/40"
                      : "border-stone-200 text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  Carousel
                </button>
                <button
                  type="button"
                  disabled={photoSlidesForMeta.length === 0}
                  title={
                    photoSlidesForMeta.length > 0
                      ? "Single 4:5 image post"
                      : "Generate the image post on the Image tab first"
                  }
                  onClick={() => {
                    if (photoSlidesForMeta.length === 0) return;
                    seedCaptionForMetaKind("photo");
                  }}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    metaPublishKind === "photo"
                      ? "border-sky-400 bg-sky-50 text-sky-950 ring-2 ring-sky-300/50"
                      : "border-stone-200 text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  Photo
                </button>
                <button
                  type="button"
                  disabled={!shortOutputFile}
                  title={
                    shortOutputFile
                      ? "Video to Short reel"
                      : "Generate the short on the Short tab first"
                  }
                  onClick={() => {
                    if (!shortOutputFile) return;
                    seedCaptionForMetaKind("short");
                  }}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    metaPublishKind === "short"
                      ? "border-violet-400 bg-violet-50 text-violet-950 ring-2 ring-violet-300/50"
                      : "border-stone-200 text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  Short
                </button>
              </div>
            </div>
            <label className="mt-4 block text-sm font-medium text-stone-800">
              Caption
              <textarea
                value={scheduleCaption}
                onChange={(e) => setScheduleCaption(e.target.value)}
                rows={5}
                className="mt-1.5 w-full resize-y rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-palette-teal focus:outline-none focus:ring-1 focus:ring-palette-teal"
                placeholder="Caption for Instagram, Facebook, and YouTube…"
              />
            </label>
            <fieldset className="mt-4 space-y-2">
              <legend className="text-sm font-medium text-stone-800">
                Destinations
              </legend>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={postToInstagram}
                  onChange={(e) => setPostToInstagram(e.target.checked)}
                  className="rounded border-stone-300 text-palette-moss focus:ring-palette-teal"
                />
                Instagram (linked to this Page)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={postToFacebook}
                  onChange={(e) => setPostToFacebook(e.target.checked)}
                  className="rounded border-stone-300 text-palette-moss focus:ring-palette-teal"
                />
                Facebook Page (same Page)
              </label>
              <label
                className={`flex items-center gap-2 text-sm ${
                  metaPublishKind === "short"
                    ? "cursor-pointer text-stone-700"
                    : "cursor-not-allowed text-stone-400"
                }`}
                title={
                  metaPublishKind === "short"
                    ? "Uploads the Short MP4 to your YouTube channel"
                    : "YouTube uses the Short MP4 — switch post type to Short"
                }
              >
                <input
                  type="checkbox"
                  disabled={metaPublishKind !== "short"}
                  checked={metaPublishKind === "short" && postToYouTube}
                  onChange={(e) => setPostToYouTube(e.target.checked)}
                  className="rounded border-stone-300 text-palette-moss focus:ring-palette-teal disabled:opacity-50"
                />
                YouTube (Short MP4)
              </label>
            </fieldset>
            {metaPublishKind === "short" &&
              postToYouTube &&
              youtubeConfigured === false && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950">
                  Connect YouTube: open{" "}
                  <a
                    href={clientApiPath("/api/youtube/auth")}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-amber-900 underline"
                  >
                    Sign in with Google
                  </a>
                  , then add{" "}
                  <code className="rounded bg-amber-100/80 px-1">
                    GOOGLE_YOUTUBE_REFRESH_TOKEN
                  </code>{" "}
                  from the callback page to{" "}
                  <code className="text-xs">.env.local</code> and restart the dev
                  server.
                </p>
              )}
            {metaPublishKind === "carousel" &&
              postToInstagram &&
              instagramSlides.length === 0 && (
                <p className="mt-2 text-sm text-red-700">
                  No 4:5 carousel files in the ZIP — re-generate or use Edit
                  carousel so exports include{" "}
                  <code className="text-xs">instagram_4x5</code> slides.
                </p>
              )}
            <label className="mt-4 block text-sm font-medium text-stone-800">
              Schedule (optional, local time)
              <input
                type="datetime-local"
                value={scheduleLocal}
                onChange={(e) => setScheduleLocal(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-palette-teal focus:outline-none focus:ring-1 focus:ring-palette-teal"
              />
            </label>
            <p className="mt-1 text-xs text-stone-500">
              Leave empty to publish as soon as each platform accepts the
              request. Meta and YouTube enforce their own scheduling windows
              (e.g. not in the past; YouTube often needs ~15+ minutes ahead).
            </p>
            {publishFeedback && (
              <p
                className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                  publishFeedback.startsWith("Published:")
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-red-200 bg-red-50 text-red-800"
                }`}
              >
                {publishFeedback}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={handleMetaPublish}
                disabled={!canSubmitPublish || publishLoading}
                className="w-full rounded-xl bg-palette-moss py-3 text-sm font-semibold text-white hover:bg-palette-depth disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishLoading ? "Publishing…" : "Publish"}
              </button>
              <button
                type="button"
                onClick={() => setScheduleOpen(false)}
                className="w-full rounded-xl border border-stone-200 bg-white py-3 text-sm font-semibold text-stone-800 hover:bg-stone-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
