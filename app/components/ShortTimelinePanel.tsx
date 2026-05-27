"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampRemovalSpan,
  formatTimelineTime,
  MIN_CUT_DURATION_SEC,
  normalizeRemoval,
  timelineRemovalsChanged,
  type TimelineData,
  type TimelineRemoval,
} from "@/lib/short-timeline-types";
import { ShortScriptPanel } from "@/app/components/ShortScriptPanel";
import type { TranscriptScriptData } from "@/lib/short-script-types";
import "./short-timeline-panel.css";

type Props = {
  jobId: string;
  timeline: TimelineData;
  script?: TranscriptScriptData | null;
  sourceVideoSrc: string;
  outputVideoSrc?: string;
  busy: boolean;
  onReprocess: (removals: TimelineRemoval[]) => void;
};

type DragState = {
  id: string;
  edge: "start" | "end";
};

export function ShortTimelinePanel({
  jobId,
  timeline: initialTimeline,
  script,
  sourceVideoSrc,
  outputVideoSrc,
  busy,
  onReprocess,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [removals, setRemovals] = useState<TimelineRemoval[]>(() =>
    initialTimeline.removals.map((r) => normalizeRemoval({ ...r }))
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWordId, setSelectedWordId] = useState<number | null>(null);
  const [view, setView] = useState<"script" | "timeline">(
    script?.words.length ? "script" : "timeline"
  );

  useEffect(() => {
    setRemovals(initialTimeline.removals.map((r) => normalizeRemoval({ ...r })));
    setSelectedId(null);
    setSelectedWordId(null);
    if (script?.words.length) {
      setView("script");
    }
  }, [jobId, initialTimeline, script]);

  const duration = Math.max(
    initialTimeline.source_duration_sec,
    ...removals.map((r) => r.end_sec),
    1
  );

  const selected = removals.find((r) => r.id === selectedId) ?? null;

  const seek = useCallback(
    (sec: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.max(0, Math.min(sec, duration));
      void v.play().catch(() => {
        /* autoplay blocked */
      });
    },
    [duration]
  );

  const patchRemoval = useCallback(
    (id: string, edge: "start" | "end", sec: number) => {
      setRemovals((prev) =>
        prev.map((r) => {
          if (r.id !== id || !r.adjustable) return r;
          const start = edge === "start" ? sec : r.start_sec;
          const end = edge === "end" ? sec : r.end_sec;
          const clamped = clampRemovalSpan(start, end, duration, edge);
          return normalizeRemoval({ ...r, ...clamped });
        })
      );
    },
    [duration]
  );

  const setRemovalBounds = useCallback(
    (id: string, start_sec: number, end_sec: number) => {
      setRemovals((prev) =>
        prev.map((r) => {
          if (r.id !== id || !r.adjustable) return r;
          const clamped = clampRemovalSpan(start_sec, end_sec, duration, "end");
          return normalizeRemoval({ ...r, ...clamped });
        })
      );
    },
    [duration]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      const track = trackRef.current;
      if (!drag || !track) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );
      patchRemoval(drag.id, drag.edge, ratio * duration);
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [duration, patchRemoval]);

  const startDrag = (
    e: ReactPointerEvent,
    id: string,
    edge: "start" | "end"
  ) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { id, edge };
    setSelectedId(id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const toggleRemoval = (id: string) => {
    setRemovals((prev) =>
      prev.map((r) =>
        r.id === id && r.adjustable ? { ...r, enabled: !r.enabled } : r
      )
    );
  };

  const resetSelected = () => {
    if (!selectedId) return;
    const orig = initialTimeline.removals.find((r) => r.id === selectedId);
    if (!orig) return;
    setRemovals((prev) =>
      prev.map((r) =>
        r.id === selectedId ? normalizeRemoval({ ...orig }) : r
      )
    );
  };

  const hasChanges = useMemo(
    () => timelineRemovalsChanged(removals, initialTimeline.removals),
    [removals, initialTimeline.removals]
  );

  const trackSegments = useMemo(() => {
    type Seg = { kind: "keep" | "cut"; start: number; end: number; id?: string };
    const cuts = removals
      .filter((r) => r.enabled)
      .sort((a, b) => a.start_sec - b.start_sec);
    const segs: Seg[] = [];
    let cursor = 0;
    for (const c of cuts) {
      if (c.start_sec > cursor + 0.02) {
        segs.push({ kind: "keep", start: cursor, end: c.start_sec });
      }
      segs.push({
        kind: "cut",
        start: c.start_sec,
        end: c.end_sec,
        id: c.id,
      });
      cursor = Math.max(cursor, c.end_sec);
    }
    if (cursor < duration - 0.02) {
      segs.push({ kind: "keep", start: cursor, end: duration });
    }
    return segs;
  }, [removals, duration]);

  const enabledCuts = removals.filter((r) => r.enabled);
  const showScriptTab = Boolean(script?.words.length);

  return (
    <div className="short-timeline-panel timeline-panel">
      {showScriptTab ? (
        <div className="advanced-view-tabs" role="tablist" aria-label="Advanced editor">
          <button
            type="button"
            role="tab"
            aria-selected={view === "script"}
            className={`advanced-view-tab${view === "script" ? " active" : ""}`}
            onClick={() => setView("script")}
          >
            Script
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "timeline"}
            className={`advanced-view-tab${view === "timeline" ? " active" : ""}`}
            onClick={() => setView("timeline")}
          >
            Timeline
          </button>
        </div>
      ) : null}

      {view === "script" && script ? (
        <>
          <div className="timeline-videos timeline-videos-compact">
            <div>
              <span className="timeline-video-label">
                Editorial reference (scrub while editing)
              </span>
              <video
                ref={videoRef}
                className="timeline-video"
                src={sourceVideoSrc}
                controls
                preload="metadata"
                onTimeUpdate={() =>
                  setPlayhead(videoRef.current?.currentTime ?? 0)
                }
              />
            </div>
            {outputVideoSrc ? (
              <div>
                <span className="timeline-video-label">Output</span>
                <video
                  className="timeline-video"
                  src={outputVideoSrc}
                  controls
                  preload="metadata"
                />
              </div>
            ) : null}
          </div>
          <ShortScriptPanel
            script={script}
            removals={removals}
            duration={duration}
            busy={busy}
            selectedWordId={selectedWordId}
            onSelectWord={setSelectedWordId}
            onRemovalsChange={setRemovals}
            onSeek={seek}
          />
        </>
      ) : (
        <>
      <p className="timeline-intro">
        Red regions are removed on the <strong>editorial reference</strong> timeline (
        {formatTimelineTime(0)}–{formatTimelineTime(duration)}). Drag the handles on
        a selected cut to shorten or lengthen it, or edit in/out times below. Uncheck
        to keep a section. Then re-run.
      </p>

      <div className="timeline-videos">
        <div>
          <span className="timeline-video-label">Editorial reference (for cuts)</span>
          <video
            ref={videoRef}
            className="timeline-video"
            src={sourceVideoSrc}
            controls
            preload="metadata"
            onTimeUpdate={() =>
              setPlayhead(videoRef.current?.currentTime ?? 0)
            }
          />
        </div>
        {outputVideoSrc ? (
          <div>
            <span className="timeline-video-label">Output</span>
            <video
              className="timeline-video"
              src={outputVideoSrc}
              controls
              preload="metadata"
            />
          </div>
        ) : null}
      </div>

      <div className="timeline-track-wrap" aria-label="Source timeline">
        <div className="timeline-track" ref={trackRef}>
          {trackSegments.map((seg) => {
            const left = (seg.start / duration) * 100;
            const width = ((seg.end - seg.start) / duration) * 100;
            const isCut = seg.kind === "cut";
            const cut = isCut ? removals.find((r) => r.id === seg.id) : null;
            const showHandles =
              isCut &&
              cut?.enabled &&
              cut.adjustable &&
              selectedId === seg.id;

            if (isCut && seg.id) {
              return (
                <div
                  key={`cut-${seg.id}-${seg.start}-${seg.end}`}
                  className={`timeline-cut-block${selectedId === seg.id ? " selected" : ""}`}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 0.5)}%`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(seg.id!);
                    seek(seg.start);
                  }}
                >
                  {showHandles ? (
                    <>
                      <button
                        type="button"
                        className="timeline-cut-handle start"
                        aria-label="Adjust cut in point"
                        disabled={busy}
                        onPointerDown={(e) => startDrag(e, seg.id!, "start")}
                      />
                      <button
                        type="button"
                        className="timeline-cut-handle end"
                        aria-label="Adjust cut out point"
                        disabled={busy}
                        onPointerDown={(e) => startDrag(e, seg.id!, "end")}
                      />
                    </>
                  ) : null}
                </div>
              );
            }

            return (
              <button
                key={`keep-${seg.start}-${seg.end}`}
                type="button"
                className="timeline-seg keep"
                style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%` }}
                title={`Kept ${formatTimelineTime(seg.start)}–${formatTimelineTime(seg.end)}`}
                onClick={() => seek(seg.start)}
              />
            );
          })}
          <span
            className="timeline-playhead"
            style={{ left: `${(playhead / duration) * 100}%` }}
          />
        </div>
        <div className="timeline-ruler">
          <span>{formatTimelineTime(0)}</span>
          <span>{formatTimelineTime(duration / 2)}</span>
          <span>{formatTimelineTime(duration)}</span>
        </div>
      </div>

      <div className="timeline-legend">
        <span>
          <i className="swatch keep" /> Kept
        </span>
        <span>
          <i className="swatch cut" /> Removed — drag edges when selected
        </span>
      </div>

      {selected && selected.enabled && selected.adjustable ? (
        <div className="timeline-trim-editor card-inline">
          <p className="timeline-trim-title">Trim cut · {selected.kind}</p>
          <div className="timeline-trim-fields">
            <label className="mini">
              <span>In (sec)</span>
              <input
                type="number"
                step={0.05}
                min={0}
                max={selected.end_sec - MIN_CUT_DURATION_SEC}
                value={selected.start_sec}
                disabled={busy}
                onChange={(e) =>
                  setRemovalBounds(
                    selected.id,
                    Number(e.target.value),
                    selected.end_sec
                  )
                }
              />
            </label>
            <label className="mini">
              <span>Out (sec)</span>
              <input
                type="number"
                step={0.05}
                min={selected.start_sec + MIN_CUT_DURATION_SEC}
                max={duration}
                value={selected.end_sec}
                disabled={busy}
                onChange={(e) =>
                  setRemovalBounds(
                    selected.id,
                    selected.start_sec,
                    Number(e.target.value)
                  )
                }
              />
            </label>
            <span className="timeline-trim-duration">
              Duration {selected.duration_sec.toFixed(2)}s
            </span>
          </div>
          <div className="timeline-trim-actions">
            <button
              type="button"
              className="btn-timeline-secondary"
              disabled={busy}
              onClick={() =>
                patchRemoval(selected.id, "start", selected.start_sec - 0.1)
              }
            >
              In −0.1s
            </button>
            <button
              type="button"
              className="btn-timeline-secondary"
              disabled={busy}
              onClick={() =>
                patchRemoval(selected.id, "start", selected.start_sec + 0.1)
              }
            >
              In +0.1s
            </button>
            <button
              type="button"
              className="btn-timeline-secondary"
              disabled={busy}
              onClick={() =>
                patchRemoval(selected.id, "end", selected.end_sec - 0.1)
              }
            >
              Out −0.1s
            </button>
            <button
              type="button"
              className="btn-timeline-secondary"
              disabled={busy}
              onClick={() =>
                patchRemoval(selected.id, "end", selected.end_sec + 0.1)
              }
            >
              Out +0.1s
            </button>
            <button
              type="button"
              className="btn-timeline-secondary"
              disabled={busy}
              onClick={resetSelected}
            >
              Reset cut
            </button>
          </div>
        </div>
      ) : null}

      <ul className="timeline-cuts-list">
        {removals.map((r) => (
          <li
            key={r.id}
            className={`timeline-cut-row${selectedId === r.id ? " selected" : ""}${!r.enabled ? " disabled" : ""}`}
          >
            <label className="timeline-cut-check">
              <input
                type="checkbox"
                checked={r.enabled}
                disabled={busy}
                onChange={() => toggleRemoval(r.id)}
              />
            </label>
            <button
              type="button"
              className="timeline-cut-body"
              onClick={() => {
                setSelectedId(r.id);
                seek(r.start_sec);
              }}
            >
              <span className="timeline-cut-time">
                {formatTimelineTime(r.start_sec)}–{formatTimelineTime(r.end_sec)}
                <span className={`tag ${r.kind}`}>{r.kind}</span>
              </span>
              <span className="timeline-cut-reason">{r.reason}</span>
              {r.snippet ? (
                <span className="timeline-cut-snippet">{r.snippet}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <p className="timeline-stats">
        {enabledCuts.length} cut{enabledCuts.length === 1 ? "" : "s"} enabled · about{" "}
        {formatTimelineTime(
          enabledCuts.reduce((s, r) => s + r.duration_sec, 0)
        )}{" "}
        removed from source
      </p>
        </>
      )}

      <div className="timeline-actions">
        <button
          type="button"
          className="btn-timeline-primary"
          disabled={busy || !hasChanges}
          onClick={() => onReprocess(removals)}
        >
          Re-run with {view === "script" ? "script" : "timeline"} changes
        </button>
        {!hasChanges ? (
          <span className="timeline-actions-hint">
            {view === "script"
              ? "Tap lines to cut or restore them, then re-run."
              : "Drag handles, edit times, or toggle cuts to enable re-run."}
          </span>
        ) : null}
      </div>
    </div>
  );
}
