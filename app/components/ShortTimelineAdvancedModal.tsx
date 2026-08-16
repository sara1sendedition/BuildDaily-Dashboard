"use client";

import { useCallback, useEffect, useState } from "react";
import { clientApiPath } from "@/lib/client-api-path";
import {
  fetchJobPollState,
  type StudioShortTextOptions,
} from "@/lib/run-video-to-short";
import {
  parseTimelineFromMeta,
  type TimelineData,
  type TimelineRemoval,
} from "@/lib/short-timeline-types";
import { parseScriptFromMeta, type TranscriptScriptData } from "@/lib/short-script-types";
import { ShortTimelinePanel } from "@/app/components/ShortTimelinePanel";

type Props = {
  open: boolean;
  onClose: () => void;
  shortJobId: string;
  busy: boolean;
  outputPreviewUrl?: string | null;
  buildReprocessOptions: () => StudioShortTextOptions;
  onReprocess: (opts: StudioShortTextOptions) => Promise<boolean>;
};

function emptyTimeline(sourceDurationSec: number): TimelineData {
  return {
    source_duration_sec: Math.max(sourceDurationSec, 1),
    output_duration_sec: 0,
    removals: [],
    keep_spans: [],
  };
}

function metaFromPoll(state: Record<string, unknown>): Record<string, unknown> {
  const raw = state.meta;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function ShortTimelineAdvancedModal({
  open,
  onClose,
  shortJobId,
  busy,
  outputPreviewUrl,
  buildReprocessOptions,
  onReprocess,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [script, setScript] = useState<TranscriptScriptData | null>(null);
  const loadTimeline = useCallback(async (cancelled?: () => boolean) => {
    setLoading(true);
    setLoadError(null);
    try {
      const state = await fetchJobPollState(shortJobId);
      if (cancelled?.()) return;
      const meta = metaFromPoll(state as Record<string, unknown>);
      const parsedTimeline = parseTimelineFromMeta(meta);
      const parsedScript = parseScriptFromMeta(meta);
      if (!parsedTimeline && !parsedScript) {
        if (cancelled?.()) return;
        setTimeline(null);
        setScript(null);
        setLoadError(
          "No script or timeline yet. Re-process with smart editorial enabled, then open Advanced again."
        );
        return;
      }
      if (cancelled?.()) return;
      const scriptDuration =
        parsedScript?.words.reduce(
          (max, s) => Math.max(max, s.end_sec),
          0
        ) ?? 0;
      setScript(parsedScript);
      setTimeline(
        parsedTimeline ??
          emptyTimeline(
            scriptDuration ||
              parsedScript?.words[parsedScript.words.length - 1]?.end_sec ||
              60
          )
      );
    } catch (e) {
      if (cancelled?.()) return;
      setTimeline(null);
      setScript(null);
      setLoadError(
        e instanceof Error ? e.message : "Could not load timeline from Short job."
      );
    } finally {
      if (!cancelled?.()) setLoading(false);
    }
  }, [shortJobId]);

  useEffect(() => {
    if (!open || !shortJobId) {
      setTimeline(null);
      setScript(null);
      setLoadError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void loadTimeline(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [open, shortJobId, loadTimeline]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const handleTimelineReprocess = useCallback(
    async (removals: TimelineRemoval[]) => {
      await onReprocess({
        ...buildReprocessOptions(),
        timelineRemovals: removals,
      });
      await loadTimeline();
    },
    [buildReprocessOptions, onReprocess, loadTimeline]
  );

  const showPanel = !loading && !loadError && timeline;

  if (!open) return null;

  const sourceVideoSrc = clientApiPath(
    `/api/video-to-short/jobs/${encodeURIComponent(shortJobId)}/source-video`
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="short-timeline-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-stone-900/50"
        aria-label="Close timeline editor"
        disabled={busy}
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div className="relative z-10 flex max-h-[min(92vh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <h2
            id="short-timeline-modal-title"
            className="text-base font-semibold text-stone-900"
          >
            Advanced — edit script &amp; timeline
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-2 py-1 text-sm font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-50"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {busy ? (
            <p className="mb-3 text-sm font-medium text-stone-800" role="status">
              Re-processing short…
            </p>
          ) : null}
          {loading ? (
            <p className="text-sm text-stone-600">Loading timeline…</p>
          ) : loadError ? (
            <p className="text-sm text-amber-900">{loadError}</p>
          ) : showPanel ? (
            <ShortTimelinePanel
              jobId={shortJobId}
              timeline={timeline}
              script={script}
              sourceVideoSrc={sourceVideoSrc}
              outputVideoSrc={outputPreviewUrl ?? undefined}
              busy={busy}
              onReprocess={(removals) => void handleTimelineReprocess(removals)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
