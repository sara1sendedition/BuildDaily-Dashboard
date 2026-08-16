import assert from "node:assert/strict";
import {
  excerptTranscript,
  heuristicStitchGroups,
  parseStitchGroupPlan,
  transcriptPlainText,
  type StitchGroupClipInput,
} from "../lib/stitch-group-plan";

assert.equal(transcriptPlainText([{ text: "  hi " }, { text: "there" }]), "hi there");
assert.equal(transcriptPlainText([]), "");

const long = "a".repeat(2000);
const excerpt = excerptTranscript(long, 100);
assert.ok(excerpt.length <= 100);
assert.ok(excerpt.includes("…"));

const ids = ["a", "b", "c"];
const parsed = parseStitchGroupPlan(
  {
    groups: [
      { fileIds: ["b", "a", "zzz"], reason: "Continuation" },
      { fileIds: ["b"], reason: "dup ignored" },
    ],
  },
  ids
);
assert.deepEqual(
  parsed.map((g) => g.fileIds),
  [["b", "a"], ["c"]]
);
assert.equal(parsed[0]!.kind, "stitch");
assert.equal(parsed[1]!.kind, "solo");

const clips: StitchGroupClipInput[] = [
  {
    fileId: "1",
    name: "IMG_1001.MOV",
    modifiedAt: "2026-08-15T18:00:00.000Z",
    durationSec: 20,
    text: "so the hip",
  },
  {
    fileId: "2",
    name: "IMG_1002.MOV",
    modifiedAt: "2026-08-15T18:01:30.000Z",
    durationSec: 18,
    text: "needs to stay in",
  },
  {
    fileId: "3",
    name: "IMG_2000.MOV",
    modifiedAt: "2026-08-15T20:00:00.000Z",
    durationSec: 40,
    text: "totally different drill",
  },
];
const heur = heuristicStitchGroups(clips);
assert.equal(heur.length, 2);
assert.deepEqual(heur[0]!.fileIds, ["1", "2"]);
assert.equal(heur[0]!.kind, "stitch");
assert.deepEqual(heur[1]!.fileIds, ["3"]);
assert.equal(heur[1]!.kind, "solo");

console.log("stitch-group-plan-test: ok");
