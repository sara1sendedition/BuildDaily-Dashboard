import assert from "node:assert/strict";
import {
  isWordRemovedByRemovals,
  parseScriptFromMeta,
  toggleWordInRemovals,
} from "../lib/short-script-types";
import { normalizeRemoval } from "../lib/short-timeline-types";

const legacyMeta = {
  transcript_script: {
    segments: [
      {
        id: 0,
        start_sec: 0,
        end_sec: 2,
        text: "Opening hook",
        removed: false,
        removal_kinds: [],
      },
    ],
  },
};

const legacy = parseScriptFromMeta(legacyMeta);
assert.ok(legacy);
assert.equal(legacy!.words.length, 1);
assert.equal(legacy!.words[0]!.kind, "word");

const meta = {
  transcript_script: {
    words: [
      {
        id: 0,
        start_sec: 0,
        end_sec: 0.4,
        text: "Opening",
        kind: "word",
        removed: false,
        removal_kinds: [],
      },
      {
        id: 1,
        start_sec: 0.4,
        end_sec: 0.8,
        text: "hook",
        kind: "word",
        removed: false,
        removal_kinds: [],
      },
      {
        id: 2,
        start_sec: 2,
        end_sec: 2.4,
        text: "False",
        kind: "word",
        removed: true,
        removal_kinds: ["editorial"],
      },
      {
        id: 3,
        start_sec: 2.4,
        end_sec: 2.8,
        text: "start",
        kind: "word",
        removed: true,
        removal_kinds: ["editorial"],
      },
    ],
  },
};

const script = parseScriptFromMeta(meta);
assert.ok(script);
assert.equal(script!.words.length, 4);

const removals = [
  normalizeRemoval({
    id: "e-2-5",
    kind: "editorial",
    start_sec: 2,
    end_sec: 5,
    duration_sec: 3,
    reason: "retake",
    snippet: "False start",
    adjustable: true,
    enabled: true,
  }),
];

assert.equal(isWordRemovedByRemovals(script!.words[2]!, removals), true);
const restored = toggleWordInRemovals(script!.words[2]!, removals, 60);
assert.ok(restored.length >= 1);
assert.equal(
  isWordRemovedByRemovals(script!.words[2]!, restored),
  false
);

const cutAgain = toggleWordInRemovals(script!.words[0]!, restored, 60);
assert.ok(cutAgain.length >= 1);
assert.equal(isWordRemovedByRemovals(script!.words[0]!, cutAgain), true);

console.log("short-script-types-test: ok");
