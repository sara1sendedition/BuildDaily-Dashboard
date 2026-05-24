"use client";

import {
  isSegmentRemovedByRemovals,
  scriptSegmentTimeLabel,
  toggleSegmentInRemovals,
  type TranscriptScriptData,
  type TranscriptScriptSegment,
} from "@/lib/short-script-types";
import type { TimelineRemoval } from "@/lib/short-timeline-types";

type Props = {
  script: TranscriptScriptData;
  removals: TimelineRemoval[];
  duration: number;
  busy: boolean;
  selectedSegmentId: number | null;
  onSelectSegment: (id: number | null) => void;
  onRemovalsChange: (removals: TimelineRemoval[]) => void;
  onSeek: (sec: number) => void;
};

export function ShortScriptPanel({
  script,
  removals,
  duration,
  busy,
  selectedSegmentId,
  onSelectSegment,
  onRemovalsChange,
  onSeek,
}: Props) {
  const removedCount = script.segments.filter((s) =>
    isSegmentRemovedByRemovals(s, removals)
  ).length;
  const keptCount = script.segments.length - removedCount;

  const handleToggle = (seg: TranscriptScriptSegment) => {
    if (busy) return;
    onRemovalsChange(toggleSegmentInRemovals(seg, removals, duration));
    onSelectSegment(seg.id);
    onSeek(seg.start_sec);
  };

  return (
    <div className="script-panel">
      <p className="timeline-intro">
        Tap a line to <strong>cut</strong> or <strong>restore</strong> it. Removed
        lines are struck through and won&apos;t appear in the output after you
        re-run. Silence trims stay on the Timeline tab.
      </p>

      <p className="timeline-stats">
        {keptCount} kept · {removedCount} removed · {script.segments.length} lines
      </p>

      <ol className="script-segment-list">
        {script.segments.map((seg) => {
          const removed = isSegmentRemovedByRemovals(seg, removals);
          const selected = selectedSegmentId === seg.id;
          return (
            <li
              key={seg.id}
              className={`script-segment-row${removed ? " removed" : " kept"}${selected ? " selected" : ""}`}
            >
              <button
                type="button"
                className="script-segment-btn"
                disabled={busy}
                aria-pressed={removed}
                title={
                  removed
                    ? "Click to restore this line in the output"
                    : "Click to cut this line from the output"
                }
                onClick={() => handleToggle(seg)}
              >
                <span className="script-segment-meta">
                  <span className="script-segment-time">
                    {scriptSegmentTimeLabel(seg)}
                  </span>
                  <span
                    className={`script-segment-badge${removed ? " cut" : " keep"}`}
                  >
                    {removed ? "Removed" : "Kept"}
                  </span>
                </span>
                <span className={`script-segment-text${removed ? " struck" : ""}`}>
                  {seg.text}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
