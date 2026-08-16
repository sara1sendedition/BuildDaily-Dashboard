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

const listicle: StitchGroupClipInput[] = [
  {
    fileId: "a",
    name: "IMG_1101.MOV",
    modifiedAt: "2026-08-15T18:00:00.000Z",
    durationSec: 12,
    text: "here are three ways to make climbing easier",
  },
  {
    fileId: "b",
    name: "IMG_1102.MOV",
    modifiedAt: "2026-08-15T18:08:00.000Z",
    durationSec: 20,
    text: "first, keep your hips in",
  },
  {
    fileId: "c",
    name: "IMG_1103.MOV",
    modifiedAt: "2026-08-15T18:22:00.000Z",
    durationSec: 18,
    text: "next, trust your feet",
  },
];
const listHeur = heuristicStitchGroups(listicle);
assert.equal(listHeur.length, 1);
assert.deepEqual(listHeur[0]!.fileIds, ["a", "b", "c"]);
assert.equal(listHeur[0]!.kind, "stitch");

console.log("stitch-group-plan-test: ok");
