"use client";

import { useMemo } from "react";
import {
  groupWordsIntoParagraphs,
  isWordRemovedByRemovals,
  scriptWordCount,
  scriptWordTimeLabel,
  toggleWordInRemovals,
  type TranscriptScriptData,
  type TranscriptScriptWord,
} from "@/lib/short-script-types";
import type { TimelineRemoval } from "@/lib/short-timeline-types";

type Props = {
  script: TranscriptScriptData;
  removals: TimelineRemoval[];
  duration: number;
  busy: boolean;
  selectedWordId: number | null;
  onSelectWord: (id: number | null) => void;
  onRemovalsChange: (removals: TimelineRemoval[]) => void;
  onSeek: (sec: number) => void;
};

export function ShortScriptPanel({
  script,
  removals,
  duration,
  busy,
  selectedWordId,
  onSelectWord,
  onRemovalsChange,
  onSeek,
}: Props) {
  const paragraphs = useMemo(
    () => groupWordsIntoParagraphs(script.words),
    [script.words]
  );

  const speechWords = script.words.filter((w) => w.kind === "word");
  const removedCount = speechWords.filter((w) =>
    isWordRemovedByRemovals(w, removals)
  ).length;
  const keptCount = speechWords.length - removedCount;
  const totalWords = scriptWordCount(script);

  const handleToggle = (word: TranscriptScriptWord) => {
    if (busy) return;
    onRemovalsChange(toggleWordInRemovals(word, removals, duration));
    onSelectWord(word.id);
    onSeek(word.start_sec);
  };

  return (
    <div className="script-panel">
      <p className="timeline-intro">
        Click any <strong>word</strong> to cut or restore it (Descript-style).
        Cut words are struck through and drop out after you re-run. Silence
        blocks are one click. Timestamps match the editorial reference video.
        Fine trims stay on the Timeline tab.
      </p>

      <p className="timeline-stats">
        {keptCount} words kept · {removedCount} cut · {totalWords} total
      </p>

      <div className="script-document" role="document" aria-label="Transcript">
        {paragraphs.map((para, pi) => {
          const gapOnly = para.length === 1 && para[0]?.kind === "gap";
          if (gapOnly) {
            const gap = para[0]!;
            const removed = isWordRemovedByRemovals(gap, removals);
            const selected = selectedWordId === gap.id;
            return (
              <button
                key={`gap-${gap.id}-${pi}`}
                type="button"
                className={`script-gap-block${removed ? " removed" : ""}${selected ? " selected" : ""}`}
                disabled={busy}
                onClick={() => handleToggle(gap)}
                title={scriptWordTimeLabel(gap)}
              >
                {gap.text}
              </button>
            );
          }
          return (
            <p key={`p-${pi}`} className="script-paragraph">
              {para.map((word) => {
                if (word.kind === "gap") {
                  const removed = isWordRemovedByRemovals(word, removals);
                  const selected = selectedWordId === word.id;
                  return (
                    <button
                      key={`gap-${word.id}`}
                      type="button"
                      className={`script-gap-inline${removed ? " removed" : ""}${selected ? " selected" : ""}`}
                      disabled={busy}
                      onClick={() => handleToggle(word)}
                      title={scriptWordTimeLabel(word)}
                    >
                      {word.text}
                    </button>
                  );
                }
                const removed = isWordRemovedByRemovals(word, removals);
                const selected = selectedWordId === word.id;
                return (
                  <button
                    key={word.id}
                    type="button"
                    className={`script-word${removed ? " removed" : " kept"}${selected ? " selected" : ""}`}
                    disabled={busy}
                    aria-pressed={removed}
                    title={`${scriptWordTimeLabel(word)} — click to ${removed ? "restore" : "cut"}`}
                    onClick={() => handleToggle(word)}
                  >
                    {word.text}
                  </button>
                );
              })}
            </p>
          );
        })}
      </div>
    </div>
  );
}
