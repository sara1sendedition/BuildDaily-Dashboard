import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { runPipeline } from "@/lib/pipeline";
import { runImagePostPipeline } from "@/lib/pipeline-image-post";
import { ensureIngestVideoOnDisk } from "@/lib/server/resolve-ingest-video";
import { extractSlideBuffersFromZip } from "@/lib/multiplier/extract-slides-from-zip-buffer";
import {
  uploadBuffersToBunnyStorage,
  uploadFileBufferToBunnyStorage,
} from "@/lib/multiplier/upload-buffers-bunny";
import {
  aggregateQueueStatusFromOutputs,
  buildInitialOutputs,
  mergeOutputsState,
  type MultiplierOutputsState,
  type MultiplierOutputState,
} from "@/lib/multiplier-queue/output-state";
import {
  parseMultiplierJobPayload,
  type MultiplierProcessingJobPayload,
} from "@/lib/multiplier/process-job-types";
import { renewProcessingJobLease } from "@/lib/multiplier/claim-processing-jobs";
import { withOpenAIRetries } from "@/lib/openai-retry";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";
import {
  clampFrameColorAdjust,
  DEFAULT_FRAME_COLOR_ADJUST,
  type FrameColorAdjust,
} from "@/lib/frame-color-adjust";
import type { BunnyAssetUrls } from "@/lib/storage/bunny-upload-client";
import type { CarouselType, LayoutId, TranscriptSegment } from "@/lib/types";
import type { Prisma } from "@prisma/client";

async function patchQueueOutputs(opts: {
  queueItemId: string;
  userId: string;
  outputs: MultiplierOutputsState;
  bunnyUrls?: BunnyAssetUrls;
  extraPayload?: Record<string, unknown>;
  kind?: "carousel" | "photo" | "short" | null;
  status?: "processing" | "done" | "failed";
}): Promise<void> {
  let existing = await prisma.multiplierQueueItem.findFirst({
    where: { id: opts.queueItemId, userId: opts.userId },
  });
  // Queue rows can be wiped by a client bug while the worker still runs.
  // Recreate a stub so output URLs / status are not lost.
  if (!existing) {
    const job = await prisma.processingJob.findFirst({
      where: {
        userId: opts.userId,
        jobType: "multiplier_outputs",
        payload: { path: ["queueItemId"], equals: opts.queueItemId },
      },
      orderBy: { createdAt: "desc" },
    });
    const jobPayload =
      job?.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
    const videoLabel =
      (typeof jobPayload.videoLabel === "string" &&
        jobPayload.videoLabel.trim()) ||
      "video.mp4";
    const sourceVideoUrl =
      typeof jobPayload.sourceVideoUrl === "string"
        ? jobPayload.sourceVideoUrl.trim()
        : "";
    const stubPayload = {
      v: 1,
      ...(job ? { processingJobId: job.id } : {}),
      ...(sourceVideoUrl ? { bunnyUrls: { sourceVideoUrl } } : {}),
    } as Prisma.InputJsonValue;
    existing = await prisma.multiplierQueueItem.upsert({
      where: { id: opts.queueItemId },
      create: {
        id: opts.queueItemId,
        userId: opts.userId,
        status: "processing",
        videoLabel,
        payload: stubPayload,
      },
      update: {},
    });
  }
  const current =
    existing.payload && typeof existing.payload === "object"
      ? ({ ...(existing.payload as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : { v: 1 };
  const prevOutputs =
    current.outputs && typeof current.outputs === "object"
      ? (current.outputs as MultiplierOutputsState)
      : undefined;
  const mergedOutputs = mergeOutputsState(prevOutputs, opts.outputs);
  const prevBunny =
    current.bunnyUrls && typeof current.bunnyUrls === "object"
      ? (current.bunnyUrls as BunnyAssetUrls)
      : {};
  const nextPayload: Record<string, unknown> = {
    ...current,
    v: 1,
    outputs: mergedOutputs,
    ...(opts.bunnyUrls
      ? { bunnyUrls: { ...prevBunny, ...opts.bunnyUrls } }
      : {}),
    ...(opts.extraPayload ?? {}),
  };
  await prisma.multiplierQueueItem.update({
    where: { id: opts.queueItemId },
    data: {
      status: opts.status ?? aggregateQueueStatusFromOutputs(mergedOutputs),
      ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
      payload: nextPayload as Prisma.InputJsonValue,
    },
  });
}

function parseFrameAdjust(raw: unknown): FrameColorAdjust {
  if (!raw || typeof raw !== "object") return DEFAULT_FRAME_COLOR_ADJUST;
  try {
    return clampFrameColorAdjust(raw as FrameColorAdjust);
  } catch {
    return DEFAULT_FRAME_COLOR_ADJUST;
  }
}

async function createShortJobFromSource(opts: {
  videoPath: string;
  videoLabel: string;
  driveFileId?: string;
  editorialNotes?: string;
}): Promise<{ jobId: string } | null> {
  if (!isVideoToShortIntegrationEnabled()) return null;
  if (process.env.NEXT_PUBLIC_SKIP_VIDEO_TO_SHORT === "1") return null;
  const base = getVideoToShortApiBaseUrl();

  if (opts.driveFileId) {
    const fd = new FormData();
    fd.append("file_id", opts.driveFileId);
    if (opts.editorialNotes) {
      fd.append("editorial_notes", opts.editorialNotes.slice(0, 4000));
    }
    const res = await fetch(`${base}/api/jobs/from-drive`, {
      method: "POST",
      body: fd,
    });
    if (res.status === 503) {
      const j = (await res.json().catch(() => null)) as {
        disabled?: boolean;
      } | null;
      if (j?.disabled) return null;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Short from-drive failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
      );
    }
    const j = (await res.json()) as { job_id?: string; jobId?: string; id?: string };
    const jobId = (j.job_id ?? j.jobId ?? j.id ?? "").trim();
    if (!jobId) throw new Error("Short from-drive response missing job id.");
    return { jobId };
  }

  const bytes = await fs.readFile(opts.videoPath);
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "video/mp4" }),
    opts.videoLabel || "video.mp4",
  );
  if (opts.editorialNotes) {
    fd.append("editorial_notes", opts.editorialNotes.slice(0, 4000));
  }
  const res = await fetch(`${base}/api/jobs`, {
    method: "POST",
    body: fd,
  });
  if (res.status === 503) {
    const j = (await res.json().catch(() => null)) as {
      disabled?: boolean;
    } | null;
    if (j?.disabled) return null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Short create failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }
  const j = (await res.json()) as { job_id?: string; jobId?: string; id?: string };
  const jobId = (j.job_id ?? j.jobId ?? j.id ?? "").trim();
  if (!jobId) throw new Error("Short create response missing job id.");
  return { jobId };
}

type ShortPollResult =
  | {
      status: "completed";
      outputRevision?: number;
      reelBuffer?: Buffer;
    }
  | { status: "failed"; error: string }
  | { status: "processing" };

async function pollShortJobUntilDone(
  jobId: string,
  timeoutMs: number,
): Promise<ShortPollResult> {
  const base = getVideoToShortApiBaseUrl();
  const t0 = Date.now();
  let notFoundStreak = 0;
  while (Date.now() - t0 < timeoutMs) {
    const res = await fetch(`${base}/api/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    });
    if (res.status === 404) {
      notFoundStreak += 1;
      // Job retention expired / never existed — don't leave queue rows stuck forever.
      if (notFoundStreak >= 2) {
        return {
          status: "failed",
          error: "Short job no longer found on the Short server (expired or deleted).",
        };
      }
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    notFoundStreak = 0;
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    const j = (await res.json()) as Record<string, unknown>;
    const status = String(j.status ?? j.state ?? "").toLowerCase();
    if (status === "completed" || status === "done" || status === "success") {
      const meta =
        j.meta && typeof j.meta === "object"
          ? (j.meta as Record<string, unknown>)
          : {};
      const revision =
        typeof meta.output_revision === "number"
          ? meta.output_revision
          : typeof j.output_revision === "number"
            ? j.output_revision
            : undefined;
      try {
        const dl = await fetch(
          `${base}/api/jobs/${encodeURIComponent(jobId)}/download`,
          { cache: "no-store" },
        );
        if (dl.ok) {
          const buf = Buffer.from(await dl.arrayBuffer());
          return {
            status: "completed",
            outputRevision: revision,
            reelBuffer: buf,
          };
        }
      } catch {
        /* fall through */
      }
      return { status: "completed", outputRevision: revision };
    }
    if (status === "failed" || status === "error") {
      const err =
        typeof j.error === "string"
          ? j.error
          : typeof j.detail === "string"
            ? j.detail
            : "Short job failed.";
      return { status: "failed", error: err };
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  // Still processing — leave as in-flight for a later tick / client poll.
  return { status: "processing" };
}

function withOutput(
  key: keyof MultiplierOutputsState,
  state: MultiplierOutputState,
): MultiplierOutputsState {
  return { [key]: state };
}

/**
 * Process one claimed Multiplier ProcessingJob end-to-end:
 * ingest → carousel/image → Bunny upload → kick/await Short.
 */
export async function runMultiplierProcessingJob(opts: {
  jobId: string;
  userId: string;
  payload: unknown;
  attempts: number;
  leaseOwner?: string;
}): Promise<
  | { ok: true; shortPending?: false }
  | { ok: true; shortPending: true }
  | { ok: false; error: string }
> {
  const parsed = parseMultiplierJobPayload(opts.payload);
  if (!parsed) {
    return { ok: false, error: "Invalid multiplier job payload." };
  }
  if (!parsed.sourceVideoUrl && !parsed.driveFileId) {
    return {
      ok: false,
      error: "Job is missing sourceVideoUrl and driveFileId.",
    };
  }

  const workDir = path.join(tmpdir(), `mult-job-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });
  const videoPath = path.join(workDir, "input.mp4");
  const leaseOwner = opts.leaseOwner?.trim() || "";
  let renewTimer: ReturnType<typeof setInterval> | undefined;
  if (leaseOwner) {
    renewTimer = setInterval(() => {
      void renewProcessingJobLease({
        id: opts.jobId,
        leaseOwner,
      }).then((ok) => {
        if (!ok) {
          console.warn(
            `[multiplier-job] lost lease for ${opts.jobId}; another worker may have stolen it`,
          );
        }
      });
    }, 60 * 1000);
    // Don't keep the Node process alive solely for lease heartbeats.
    renewTimer.unref?.();
  }

  const wanted = parsed.outputsWanted;
  let outputs = mergeOutputsState(
    buildInitialOutputs({
      carousel: wanted.carousel,
      photo: wanted.photo,
      short: wanted.short,
    }),
    parsed.outputs,
  );

  // Resume from Hub queue state so reclaim after "Awaiting Short" does not
  // regenerate carousel/photo that already succeeded.
  const existingQueue = await prisma.multiplierQueueItem.findFirst({
    where: { id: parsed.queueItemId, userId: opts.userId },
  });
  const existingPayload =
    existingQueue?.payload && typeof existingQueue.payload === "object"
      ? (existingQueue.payload as Record<string, unknown>)
      : {};
  if (existingPayload.outputs && typeof existingPayload.outputs === "object") {
    outputs = mergeOutputsState(
      outputs,
      existingPayload.outputs as MultiplierOutputsState,
    );
  }
  const existingBunny =
    existingPayload.bunnyUrls && typeof existingPayload.bunnyUrls === "object"
      ? (existingPayload.bunnyUrls as BunnyAssetUrls)
      : {};
  const existingShortJobId =
    typeof existingPayload.shortJobId === "string"
      ? existingPayload.shortJobId.trim()
      : "";

  const bump = async (
    patch: MultiplierOutputsState,
    extra?: {
      bunnyUrls?: BunnyAssetUrls;
      extraPayload?: Record<string, unknown>;
      kind?: "carousel" | "photo" | "short" | null;
      status?: "processing" | "done" | "failed";
    },
  ) => {
    outputs = mergeOutputsState(outputs, patch);
    await patchQueueOutputs({
      queueItemId: parsed.queueItemId,
      userId: opts.userId,
      outputs,
      bunnyUrls: extra?.bunnyUrls,
      extraPayload: extra?.extraPayload,
      kind: extra?.kind,
      status: extra?.status ?? "processing",
    });
  };

  try {
    const carouselAlreadyDone =
      wanted.carousel &&
      outputs.carousel?.status === "done" &&
      Array.isArray(existingBunny.slideUrls) &&
      existingBunny.slideUrls.length > 0;
    const photoAlreadyDone =
      wanted.photo &&
      outputs.photo?.status === "done" &&
      Boolean(existingBunny.imagePostUrl?.trim());
    const shortAlreadyDone =
      wanted.short &&
      outputs.short?.status === "done" &&
      Boolean(existingBunny.reelMp4Url?.trim());
    const shortInFlight =
      wanted.short &&
      !shortAlreadyDone &&
      Boolean(existingShortJobId) &&
      outputs.short?.status === "processing";

    await bump({
      ...(wanted.carousel && !carouselAlreadyDone
        ? withOutput("carousel", {
            status: "processing",
            progress: "Ingesting video…",
            attempts: opts.attempts,
          })
        : {}),
      ...(wanted.photo && !photoAlreadyDone
        ? withOutput("photo", {
            status: "processing",
            progress: "Ingesting video…",
            attempts: opts.attempts,
          })
        : {}),
      ...(wanted.short && !shortAlreadyDone
        ? withOutput("short", {
            status: "processing",
            progress: shortInFlight
              ? "Resuming Short wait…"
              : "Ingesting video…",
            attempts: opts.attempts,
          })
        : {}),
    });

    const needsIngest =
      (wanted.carousel && !carouselAlreadyDone) ||
      (wanted.photo && !photoAlreadyDone) ||
      (wanted.short && !shortAlreadyDone && !shortInFlight);

    const fields: Record<string, string> = {};
    if (parsed.driveFileId) fields.driveFileId = parsed.driveFileId;
    if (parsed.sourceVideoUrl) fields.sourceVideoUrl = parsed.sourceVideoUrl;
    if (needsIngest) {
      await ensureIngestVideoOnDisk(videoPath, fields, false, {
        fetchTimeoutMs: 600_000,
      });
    }

    const key = process.env.OPENAI_API_KEY ?? "";
    const useStub =
      process.env.USE_STUB_LLM === "true" || process.env.USE_STUB_LLM === "1";
    if (!key && !useStub && (wanted.carousel || wanted.photo)) {
      throw new Error(
        "Missing OPENAI_API_KEY. Set it or enable USE_STUB_LLM=true.",
      );
    }

    const layoutId = (
      parsed.studioSettings?.layoutId === "split_lower_third"
        ? "split_lower_third"
        : "stacked_center"
    ) as LayoutId;
    const carouselOverride = (
      typeof parsed.studioSettings?.carouselOverride === "string"
        ? parsed.studioSettings.carouselOverride
        : ""
    ) as CarouselType | "";
    const frameColorAdjust = parseFrameAdjust(
      parsed.studioSettings?.frameColorAdjust,
    );
    const focus = (parsed.aiInstructions ?? "").trim() || undefined;

    let transcript: TranscriptSegment[] = [];
    let durationSec: number | null = null;
    const bunnyUrls: BunnyAssetUrls = { ...existingBunny };
    if (parsed.sourceVideoUrl) bunnyUrls.sourceVideoUrl = parsed.sourceVideoUrl;

    // Kick Short early (durable on V2S) so it overlaps carousel/image work.
    // Skip create when already done or an in-flight shortJobId exists.
    let shortJobId: string | undefined = shortInFlight
      ? existingShortJobId
      : undefined;
    let shortCreateError: string | undefined;
    const shortPromise =
      wanted.short && !shortAlreadyDone && !shortInFlight
        ? (async () => {
            await bump(
              withOutput("short", {
                status: "processing",
                progress: "Starting Short…",
                attempts: opts.attempts,
              }),
            );
            try {
              const created = await createShortJobFromSource({
                videoPath,
                videoLabel: parsed.videoLabel,
                driveFileId: parsed.driveFileId,
                editorialNotes: focus,
              });
              if (!created) {
                await bump(
                  withOutput("short", {
                    status: "skipped",
                    progress: undefined,
                    error: "Video to Short is off or unreachable.",
                  }),
                );
                return;
              }
              shortJobId = created.jobId;
              await bump(
                withOutput("short", {
                  status: "processing",
                  progress: "Short encoding…",
                }),
                { extraPayload: { shortJobId } },
              );
            } catch (e) {
              shortCreateError =
                e instanceof Error ? e.message : "Short create failed.";
              await bump(
                withOutput("short", {
                  status: "failed",
                  error: shortCreateError,
                  attempts: (opts.attempts ?? 0) + 1,
                }),
              );
            }
          })()
        : Promise.resolve();

    if (wanted.carousel && !carouselAlreadyDone) {
      await bump(
        withOutput("carousel", {
          status: "processing",
          progress: "Generating carousel…",
        }),
      );
      try {
        const pipelineResult = await withOpenAIRetries(
          () =>
            runPipeline({
              videoPath,
              title: parsed.videoLabel,
              hint: undefined,
              carouselTypeOverride: carouselOverride || undefined,
              brandingId: "default",
              layoutId,
              openaiApiKey: key || "stub",
              useStubLlm: useStub,
              existingTranscript:
                transcript.length > 0 ? transcript : undefined,
              carouselFocus: focus,
              frameColorAdjust,
            }),
          { label: `carousel:${opts.jobId}` },
        );
        transcript = pipelineResult.transcript;
        durationSec = pipelineResult.durationSec;
        const { youtube, instagram } = await extractSlideBuffersFromZip(
          pipelineResult.zipBuffer,
        );
        const slideBuffers =
          youtube.length > 0
            ? youtube
            : pipelineResult.firstSlidePng
              ? [pipelineResult.firstSlidePng]
              : [];
        if (slideBuffers.length === 0) {
          throw new Error("Carousel pipeline produced no slide images.");
        }
        const prefix = parsed.videoLabel
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40);
        bunnyUrls.slideUrls = await uploadBuffersToBunnyStorage(slideBuffers, {
          userId: opts.userId,
          prefix: `${prefix || "slide"}-yt`,
        });
        if (instagram.length > 0) {
          bunnyUrls.slideUrlsInstagram = await uploadBuffersToBunnyStorage(
            instagram,
            {
              userId: opts.userId,
              prefix: `${prefix || "slide"}-ig`,
            },
          );
        }
        await bump(
          withOutput("carousel", {
            status: "done",
            progress: undefined,
            error: undefined,
          }),
          {
            bunnyUrls,
            extraPayload: {
              socialCaption: pipelineResult.socialCaption,
              durationSec: pipelineResult.durationSec,
              effectiveType: pipelineResult.effectiveType,
              layoutId,
              ...(carouselOverride ? { carouselOverride } : {}),
              editableSlides: pipelineResult.slides.map((s) => ({
                headline: s.headline,
                body: typeof s.body === "string" ? s.body : undefined,
              })),
              transcript: pipelineResult.transcript.map((t) => ({
                id: t.id,
                text: t.text,
                startSec: t.startSec,
                endSec: t.endSec,
              })),
            },
            kind: "carousel",
          },
        );
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Carousel generation failed.";
        await bump(
          withOutput("carousel", {
            status: "failed",
            error: msg,
            attempts: (opts.attempts ?? 0) + 1,
          }),
        );
        if (!wanted.photo && !wanted.short) throw e;
      }
    }

    if (wanted.photo && !photoAlreadyDone) {
      await bump(
        withOutput("photo", {
          status: "processing",
          progress: "Generating image post…",
        }),
      );
      try {
        const imageResult = await withOpenAIRetries(
          () =>
            runImagePostPipeline({
              videoPath,
              title: parsed.videoLabel,
              openaiApiKey: key || "stub",
              useStubLlm: useStub,
              existingTranscript:
                transcript.length > 0 ? transcript : undefined,
              frameColorAdjust,
            }),
          { label: `photo:${opts.jobId}` },
        );
        if (transcript.length === 0) transcript = imageResult.transcript;
        if (durationSec == null) durationSec = imageResult.durationSec;
        bunnyUrls.imagePostUrl = await uploadFileBufferToBunnyStorage(
          imageResult.pngBuffer,
          {
            userId: opts.userId,
            filename: `${parsed.queueItemId.slice(0, 8)}-image-post.jpg`,
            contentType: "image/jpeg",
          },
        );
        await bump(
          withOutput("photo", {
            status: "done",
            progress: undefined,
            error: undefined,
          }),
          {
            bunnyUrls,
            extraPayload: {
              imagePostCopy: {
                hook: imageResult.plan.hook,
                microCta: imageResult.plan.microCta,
                caption: imageResult.plan.caption,
                altText: imageResult.plan.altText,
                evidenceSegmentIds: imageResult.plan.evidenceSegmentIds,
                frameTimeSec: imageResult.frameTimeSec,
              },
              ...(durationSec != null ? { durationSec } : {}),
              ...(transcript.length > 0
                ? {
                    transcript: transcript.map((t) => ({
                      id: t.id,
                      text: t.text,
                      startSec: t.startSec,
                      endSec: t.endSec,
                    })),
                  }
                : {}),
            },
            kind: wanted.carousel ? "carousel" : "photo",
          },
        );
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Image post generation failed.";
        await bump(
          withOutput("photo", {
            status: "failed",
            error: msg,
            attempts: (opts.attempts ?? 0) + 1,
          }),
        );
        if (!wanted.carousel && !wanted.short) throw e;
      }
    }

    await shortPromise;

    if (wanted.short && !shortAlreadyDone && shortJobId && !shortCreateError) {
      await bump(
        withOutput("short", {
          status: "processing",
          progress: "Waiting for Short…",
        }),
        { extraPayload: { shortJobId } },
      );
      // Longer wait on resume ticks — Short encodes often exceed 3 minutes.
      const shortResult = await pollShortJobUntilDone(shortJobId, 300_000);
      if (shortResult.status === "completed") {
        if (shortResult.reelBuffer && shortResult.reelBuffer.length > 0) {
          bunnyUrls.reelMp4Url = await uploadFileBufferToBunnyStorage(
            shortResult.reelBuffer,
            {
              userId: opts.userId,
              filename: `${parsed.queueItemId.slice(0, 8)}-reel.mp4`,
              contentType: "video/mp4",
            },
          );
        }
        if (!bunnyUrls.reelMp4Url) {
          await bump(
            withOutput("short", {
              status: "failed",
              error: "Short completed but no reel MP4 was returned.",
              attempts: (opts.attempts ?? 0) + 1,
            }),
            { extraPayload: { shortJobId } },
          );
        } else {
          await bump(
            withOutput("short", {
              status: "done",
              progress: undefined,
              error: undefined,
            }),
            {
              bunnyUrls,
              extraPayload: {
                shortJobId,
                ...(shortResult.outputRevision != null
                  ? { shortOutputRevision: shortResult.outputRevision }
                  : {}),
              },
              kind: "short",
            },
          );
        }
      } else if (shortResult.status === "failed") {
        await bump(
          withOutput("short", {
            status: "failed",
            error: shortResult.error ?? "Short failed.",
            attempts: (opts.attempts ?? 0) + 1,
          }),
          { extraPayload: { shortJobId } },
        );
      } else {
        // Still encoding — leave processing; a later tick / client can finish.
        await bump(
          withOutput("short", {
            status: "processing",
            progress: "Short still encoding on server…",
          }),
          { extraPayload: { shortJobId } },
        );
      }
    }

    const finalStatus = aggregateQueueStatusFromOutputs(outputs);
    await bump({}, { status: finalStatus });

    // Job is "done" when carousel/photo finished even if Short is still encoding.
    const blockingFailed =
      (wanted.carousel && outputs.carousel?.status === "failed") ||
      (wanted.photo && outputs.photo?.status === "failed") ||
      (wanted.short &&
        outputs.short?.status === "failed" &&
        !wanted.carousel &&
        !wanted.photo);
    if (blockingFailed && finalStatus === "failed") {
      return {
        ok: false,
        error:
          outputs.carousel?.error ||
          outputs.photo?.error ||
          outputs.short?.error ||
          "Multiplier job failed.",
      };
    }
    if (wanted.short && outputs.short?.status === "processing") {
      // Do not mark ProcessingJob done — re-queue awaiting Short finalize.
      return { ok: true, shortPending: true };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Multiplier job failed.";
    await patchQueueOutputs({
      queueItemId: parsed.queueItemId,
      userId: opts.userId,
      outputs: mergeOutputsState(outputs, {
        ...(wanted.carousel && outputs.carousel?.status !== "done"
          ? withOutput("carousel", { status: "failed", error: message })
          : {}),
        ...(wanted.photo && outputs.photo?.status !== "done"
          ? withOutput("photo", { status: "failed", error: message })
          : {}),
        ...(wanted.short &&
        outputs.short?.status !== "done" &&
        outputs.short?.status !== "skipped"
          ? withOutput("short", { status: "failed", error: message })
          : {}),
      }),
      status: "failed",
    }).catch(() => undefined);
    return { ok: false, error: message };
  } finally {
    if (renewTimer) clearInterval(renewTimer);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Finish in-flight Shorts that were left processing after a prior tick. */
export async function finalizeInFlightShortOutputs(opts: {
  limit?: number;
}): Promise<number> {
  const limit = opts.limit ?? 8;
  // Include `failed` rows whose short output is still `processing` (e.g. after
  // download timeout left the Short half-started).
  const rows = await prisma.multiplierQueueItem.findMany({
    where: { status: { in: ["processing", "failed"] } },
    orderBy: { updatedAt: "asc" },
    take: 60,
  });
  let finished = 0;
  for (const row of rows) {
    if (finished >= limit) break;
    const payload =
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {};
    const outputs =
      payload.outputs && typeof payload.outputs === "object"
        ? (payload.outputs as MultiplierOutputsState)
        : undefined;
    const short = outputs?.short;
    if (!short || short.status !== "processing") continue;
    const shortJobId =
      typeof payload.shortJobId === "string" ? payload.shortJobId.trim() : "";
    if (!shortJobId) continue;

    const result = await pollShortJobUntilDone(shortJobId, 90_000);
    if (result.status === "processing") continue;

    if (result.status === "failed") {
      const err = result.error ?? "Short failed.";
      const expired = /no longer found|expired or deleted/i.test(err);
      const bunny =
        payload.bunnyUrls && typeof payload.bunnyUrls === "object"
          ? (payload.bunnyUrls as Record<string, unknown>)
          : {};
      const sourceVideoUrl =
        typeof bunny.sourceVideoUrl === "string"
          ? bunny.sourceVideoUrl.trim()
          : "";
      const driveFileId =
        typeof payload.driveFileId === "string"
          ? payload.driveFileId.trim()
          : "";

      // Expired Short server jobs: recreate instead of failing the whole batch.
      // Cap recreates so a down Short server cannot loop forever.
      const recreateAttempts =
        typeof short.attempts === "number" && Number.isFinite(short.attempts)
          ? short.attempts
          : 0;
      if (
        expired &&
        (sourceVideoUrl || driveFileId) &&
        recreateAttempts < 2
      ) {
        const tmpDir = path.join(tmpdir(), `mult-short-recreate-${randomUUID()}`);
        const tmpVideo = path.join(tmpDir, "input.mp4");
        try {
          await fs.mkdir(tmpDir, { recursive: true });
          const fields: Record<string, string> = {};
          if (sourceVideoUrl) fields.sourceVideoUrl = sourceVideoUrl;
          if (driveFileId) fields.driveFileId = driveFileId;
          await ensureIngestVideoOnDisk(tmpVideo, fields, false, {
            fetchTimeoutMs: 600_000,
          });
          const created = await createShortJobFromSource({
            videoPath: tmpVideo,
            videoLabel: row.videoLabel,
            driveFileId: driveFileId || undefined,
          });
          if (created?.jobId) {
            await patchQueueOutputs({
              queueItemId: row.id,
              userId: row.userId,
              outputs: {
                short: {
                  status: "processing",
                  progress: "Short recreated after server expiry…",
                  error: undefined,
                  attempts: recreateAttempts + 1,
                },
              },
              extraPayload: { shortJobId: created.jobId },
              status: "processing",
            });
            finished += 1;
            // Leave for a later tick to poll the new job.
            continue;
          }
        } catch (e) {
          const recreateErr =
            e instanceof Error ? e.message : "Short recreate failed.";
          await patchQueueOutputs({
            queueItemId: row.id,
            userId: row.userId,
            outputs: {
              short: {
                status: "failed",
                error: `${err} Recreate failed: ${recreateErr}`,
                attempts: recreateAttempts + 1,
              },
            },
          });
          finished += 1;
          continue;
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
        }
      }

      await patchQueueOutputs({
        queueItemId: row.id,
        userId: row.userId,
        outputs: {
          short: {
            status: "failed",
            error: err,
          },
        },
      });
      finished += 1;
      continue;
    }

    if (result.status !== "completed") continue;
    const bunnyUrls: BunnyAssetUrls = {};
    if (result.reelBuffer && result.reelBuffer.length > 0) {
      try {
        bunnyUrls.reelMp4Url = await uploadFileBufferToBunnyStorage(
          result.reelBuffer,
          {
            userId: row.userId,
            filename: `${row.id.slice(0, 8)}-reel.mp4`,
            contentType: "video/mp4",
          },
        );
      } catch (e) {
        await patchQueueOutputs({
          queueItemId: row.id,
          userId: row.userId,
          outputs: {
            short: {
              status: "failed",
              error:
                e instanceof Error
                  ? e.message
                  : "Failed to upload Short to Bunny.",
            },
          },
        });
        finished += 1;
        continue;
      }
    }
    if (!bunnyUrls.reelMp4Url) {
      await patchQueueOutputs({
        queueItemId: row.id,
        userId: row.userId,
        outputs: {
          short: {
            status: "failed",
            error: "Short completed but no reel MP4 was returned.",
          },
        },
        extraPayload: { shortJobId },
      });
      finished += 1;
      continue;
    }
    await patchQueueOutputs({
      queueItemId: row.id,
      userId: row.userId,
      outputs: {
        short: { status: "done", progress: undefined, error: undefined },
      },
      bunnyUrls,
      extraPayload: {
        shortJobId,
        ...(result.outputRevision != null
          ? { shortOutputRevision: result.outputRevision }
          : {}),
      },
      kind: "short",
    });
    finished += 1;
  }
  return finished;
}

export type { MultiplierProcessingJobPayload };
