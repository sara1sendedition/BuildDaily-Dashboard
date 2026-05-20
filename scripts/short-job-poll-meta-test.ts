import assert from "node:assert/strict";
import {
  pickAudioModeFromJobPoll,
  pickEditorialCutsFromJobPoll,
  pickEditorialDisplayCutsFromJobPoll,
  pickEditorialSkipFromJobPoll,
  pickEditorialSummaryFromJobPoll,
} from "../lib/short-job-poll-meta";

const poll = {
  id: "j1",
  status: "completed",
  meta: {
    editorial_summary: "Removed 2 regions.",
    editorial_cuts: [{ start_label: "0:05", end_label: "0:08", reason: "filler" }],
    editorial_skip: null,
    audio_mode: "deepfilter",
    editorialSummary: "ignored when snake present",
  },
};

assert.equal(
  pickEditorialSummaryFromJobPoll(poll),
  "Removed 2 regions."
);
assert.equal(pickEditorialSkipFromJobPoll(poll), null);
assert.ok(Array.isArray(pickEditorialCutsFromJobPoll(poll)));
assert.equal(pickAudioModeFromJobPoll(poll), "deepfilter");

assert.equal(
  pickEditorialSummaryFromJobPoll({
    meta: { editorialSummary: "Camel only" },
  }),
  "Camel only"
);

assert.equal(pickEditorialSummaryFromJobPoll({ status: "completed" }), null);

const timelinePoll = {
  meta: {
    editorial_cuts: [{ start_sec: 1, end_sec: 2, reason: "stale" }],
    timeline: {
      removals: [
        {
          kind: "editorial",
          start_sec: 5,
          end_sec: 6,
          duration_sec: 1,
          reason: "Updated cut",
          snippet: "uh",
        },
        {
          kind: "dialogue",
          start_sec: 10,
          end_sec: 11,
          duration_sec: 1,
          reason: "Pause",
          snippet: "",
        },
      ],
    },
  },
};
const display = pickEditorialDisplayCutsFromJobPoll(timelinePoll) as Array<{
  start_sec: number;
  reason: string;
}>;
assert.equal(display.length, 2);
assert.equal(display[0]?.start_sec, 5);
assert.ok(String(display[1]?.reason).includes("dialogue"));

console.log("short-job-poll-meta-test: ok");
