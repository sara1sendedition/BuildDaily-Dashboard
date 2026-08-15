import assert from "node:assert/strict";
import {
  aggregateQueueStatusFromOutputs,
  buildInitialOutputs,
  failedOutputSummary,
  localQueueStatusFromHub,
  mergeOutputsState,
  outputReadyToSchedule,
} from "../lib/multiplier-queue/output-state";

function main() {
  const initial = buildInitialOutputs({
    carousel: true,
    photo: true,
    short: false,
  });
  assert.equal(initial.carousel?.status, "queued");
  assert.equal(initial.photo?.status, "queued");
  assert.equal(initial.short?.status, "skipped");
  assert.equal(aggregateQueueStatusFromOutputs(initial), "processing");

  const merged = mergeOutputsState(initial, {
    carousel: { status: "done", readyToSchedule: true },
    photo: { status: "failed", error: "boom" },
  });
  assert.equal(merged.carousel?.readyToSchedule, true);
  assert.equal(merged.photo?.error, "boom");
  assert.equal(aggregateQueueStatusFromOutputs(merged), "done");
  assert.equal(outputReadyToSchedule(merged, "carousel"), true);
  assert.equal(outputReadyToSchedule(merged, "photo"), false);

  const pollClobber = mergeOutputsState(merged, {
    carousel: { status: "done", readyToSchedule: false, progress: undefined },
  });
  assert.equal(pollClobber.carousel?.readyToSchedule, true);

  const userUnmark = mergeOutputsState(merged, {
    carousel: { readyToSchedule: false },
  });
  assert.equal(userUnmark.carousel?.readyToSchedule, false);

  assert.equal(
    localQueueStatusFromHub({
      hubStatus: "failed",
      outputs: merged,
    }),
    "done",
  );
  assert.equal(
    localQueueStatusFromHub({
      hubStatus: "failed",
      bunnyUrls: { slideUrls: ["https://cdn.example/slide.png"] },
    }),
    "done",
  );
  assert.equal(
    localQueueStatusFromHub({
      hubStatus: "failed",
      outputs: { short: { status: "failed", error: "no reel MP4" } },
    }),
    "error",
  );
  assert.equal(
    localQueueStatusFromHub({ hubStatus: "pending" }),
    "pending",
  );
  assert.equal(
    localQueueStatusFromHub({ hubStatus: "queued" }),
    "pending",
  );
  assert.equal(
    localQueueStatusFromHub({ hubStatus: "processing" }),
    "processing",
  );
  assert.equal(
    localQueueStatusFromHub({ hubStatus: "done" }),
    "done",
  );
  assert.equal(
    failedOutputSummary(merged),
    "Image: boom",
  );

  console.log("multiplier-output-state-test: ok");
}

main();
