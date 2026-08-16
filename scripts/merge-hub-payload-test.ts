import assert from "node:assert/strict";
import {
  mergeHubQueuePayload,
  mergeQueuePayloadForJob,
  queuePayloadFailureMessage,
  resolveHubQueueStatus,
  sanitizeQueueErrorMessage,
  withQueueFailureError,
} from "../lib/multiplier-queue/merge-hub-payload";
import { unionOutputsWanted } from "../lib/multiplier/process-job-types";
import { unionStudioOutputs } from "../lib/studio-output-flags";

const current = {
  v: 1,
  processingJobId: "job-1",
  shortJobId: "short-1",
  bunnyUrls: {
    sourceVideoUrl: "https://cdn.example/source.mp4",
    reelMp4Url: "https://cdn.example/reel.mp4",
  },
  outputs: {
    carousel: { status: "done", attempts: 0 },
    short: { status: "processing", attempts: 0 },
  },
};

const thin = {
  v: 1,
  bunnyUrls: { sourceVideoUrl: "https://cdn.example/source.mp4" },
  outputs: { short: { status: "failed", error: "browser stub" } },
};

const merged = mergeHubQueuePayload(current, thin);
assert.equal(merged.processingJobId, "job-1");
assert.equal(merged.shortJobId, "short-1");
assert.equal(
  (merged.bunnyUrls as { reelMp4Url?: string }).reelMp4Url,
  "https://cdn.example/reel.mp4",
);
assert.equal(
  (merged.outputs as { carousel?: { status?: string } }).carousel?.status,
  "done",
);
assert.equal(
  (merged.outputs as { short?: { status?: string } }).short?.status,
  "failed",
);

// Client null must not wipe durable ids.
const wiped = mergeHubQueuePayload(
  { ...current, error: "keep me" },
  {
    processingJobId: null,
    shortJobId: null,
    error: null,
  },
);
assert.equal(wiped.processingJobId, "job-1");
assert.equal(wiped.shortJobId, "short-1");
assert.equal(wiped.error, "keep me");

// Null/empty bunny fields must not erase existing CDN URLs.
const bunnyWipe = mergeHubQueuePayload(current, {
  bunnyUrls: {
    sourceVideoUrl: "https://cdn.example/source.mp4",
    reelMp4Url: null,
    slideUrls: "",
  },
});
assert.equal(
  (bunnyWipe.bunnyUrls as { reelMp4Url?: string }).reelMp4Url,
  "https://cdn.example/reel.mp4",
);

assert.equal(
  resolveHubQueueStatus({
    existingStatus: "processing",
    incomingStatus: "failed",
    mergedPayload: merged,
  }),
  "processing",
);

// Premature done while short still in flight stays processing.
assert.equal(
  resolveHubQueueStatus({
    existingStatus: "processing",
    incomingStatus: "done",
    mergedPayload: {
      processingJobId: "job-1",
      outputs: {
        carousel: { status: "done" },
        short: { status: "processing" },
      },
    },
  }),
  "processing",
);

// True completion may mark done.
assert.equal(
  resolveHubQueueStatus({
    existingStatus: "processing",
    incomingStatus: "done",
    mergedPayload: {
      processingJobId: "job-1",
      outputs: {
        carousel: { status: "done" },
        short: { status: "done" },
      },
    },
  }),
  "done",
);

const preservedError = mergeHubQueuePayload(
  { v: 1, error: "Video download timed out", processingJobId: "job-1" },
  { v: 1, bunnyUrls: { sourceVideoUrl: "https://cdn.example/source.mp4" } },
);
assert.equal(preservedError.error, "Video download timed out");
assert.equal(preservedError.processingJobId, "job-1");

assert.equal(
  withQueueFailureError({ v: 1 }, "failed").error,
  "Processing failed.",
);
assert.equal(
  withQueueFailureError({ v: 1, error: "stale" }, "processing").error,
  undefined,
);
assert.equal(
  withQueueFailureError({ v: 1, error: "stale" }, "done").error,
  undefined,
);
assert.equal(
  withQueueFailureError(
    { v: 1, outputs: { short: { status: "failed", error: "no reel MP4" } } },
    "failed",
  ).error,
  "no reel MP4",
);
assert.equal(
  queuePayloadFailureMessage({
    outputs: { carousel: { error: "slide render failed" } },
  }),
  "slide render failed",
);

const reused = mergeQueuePayloadForJob(
  {
    v: 1,
    processingJobId: "old",
    error: "stale failure",
    outputs: { carousel: { status: "done" }, short: { status: "processing" } },
    bunnyUrls: { sourceVideoUrl: "https://cdn.example/a.mp4", reelMp4Url: "https://cdn.example/reel.mp4" },
  },
  {
    v: 1,
    outputs: { carousel: { status: "pending" }, short: { status: "pending" } },
    bunnyUrls: { sourceVideoUrl: "https://cdn.example/a.mp4" },
  },
  "job-keep",
  { preserveOutputs: true },
);
assert.equal(reused.processingJobId, "job-keep");
assert.equal(
  (reused.outputs as { carousel?: { status?: string } }).carousel?.status,
  "done",
);
assert.equal(
  (reused.bunnyUrls as { reelMp4Url?: string }).reelMp4Url,
  "https://cdn.example/reel.mp4",
);
assert.equal(reused.error, undefined);

assert.equal(
  sanitizeQueueErrorMessage(
    "Invalid `prisma.$queryRaw()` invocation:\nRaw query failed. Code: `N/A`. Message: `Failed to deserialize column of type 'void'.",
  ),
  "Could not start the server job. Try Add again.",
);
assert.equal(
  sanitizeQueueErrorMessage(
    "Coach Sara (8/13/2026, 7:36:20 PM): [Video Message - Transcript]\n[00:00] I certainly would not say that this was a bad script at all.\n[00:08] User Sara: rewrite\n[00:12] more",
  ),
  "Processing failed.",
);
assert.equal(
  queuePayloadFailureMessage({
    error:
      "Invalid `prisma.$queryRaw()` invocation: Failed to deserialize column of type 'void'.",
  }),
  "Could not start the server job. Try Add again.",
);

const stitchKept = mergeHubQueuePayload(
  { v: 1, stitchJobId: "stitch-keep" },
  { v: 1, stitchJobId: null },
);
assert.equal(stitchKept.stitchJobId, "stitch-keep");

const unioned = unionOutputsWanted(
  { carousel: true, photo: true, short: false },
  { carousel: false, photo: false, short: true },
);
assert.equal(unioned.carousel, true);
assert.equal(unioned.photo, true);
assert.equal(unioned.short, true);
assert.equal(unioned.xPost, undefined);

const unionFromEmpty = unionOutputsWanted(undefined, {
  carousel: false,
  photo: false,
  short: true,
  xPost: true,
});
assert.equal(unionFromEmpty.carousel, false);
assert.equal(unionFromEmpty.short, true);
assert.equal(unionFromEmpty.xPost, true);

const studioUnion = unionStudioOutputs(
  { carousel: true, imagePost: true, xPost: false, reelShort: true },
  { carousel: false, imagePost: false, xPost: false, reelShort: true },
);
assert.equal(studioUnion.carousel, true);
assert.equal(studioUnion.imagePost, true);
assert.equal(studioUnion.reelShort, true);

console.log("merge-hub-payload-test: ok");
