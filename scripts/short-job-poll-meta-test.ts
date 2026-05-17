import assert from "node:assert/strict";
import {
  pickAudioModeFromJobPoll,
  pickEditorialCutsFromJobPoll,
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

console.log("short-job-poll-meta-test: ok");
