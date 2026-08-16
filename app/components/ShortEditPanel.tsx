"use client";

import { useCallback, useEffect, useId, useState } from "react";
import {
  getShortEditorialNotesFromStorage,
  setShortEditorialNotesToStorage,
} from "@/lib/short-editorial-notes-storage";
import { MAX_CAROUSEL_FOCUS_CHARS } from "@/lib/carousel-focus";
import { parseShortAudioMode } from "@/lib/short-audio-mode";
import {
  getStudioShortPipelineSettingsFromStorage,
  setStudioShortPipelineSettingsToStorage,
  type StudioShortPipelineSettings,
} from "@/lib/studio-short-pipeline-settings";
import type { StudioShortTextOptions } from "@/lib/run-video-to-short";
import { ShortTimelineAdvancedModal } from "@/app/components/ShortTimelineAdvancedModal";

type ShortEditPanelProps = {
  shortJobId: string | null;
  busy: boolean;
  shortPreviewUrl?: string | null;
  onReprocess: (opts: StudioShortTextOptions) => Promise<boolean>;
};

export function ShortEditPanel({
  shortJobId,
  busy,
  shortPreviewUrl,
  onReprocess,
}: ShortEditPanelProps) {
  const hookId = useId();
  const overlayId = useId();
  const editorialId = useId();
  const audioId = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [hookInstructions, setHookInstructions] = useState("");
  const [hookOverlayText, setHookOverlayText] = useState("");
  const [editorialNotes, setEditorialNotes] = useState("");
  const [pipeline, setPipeline] = useState<StudioShortPipelineSettings>(() =>
    getStudioShortPipelineSettingsFromStorage()
  );

  useEffect(() => {
    setEditorialNotes(getShortEditorialNotesFromStorage());
    setPipeline(getStudioShortPipelineSettingsFromStorage());
  }, []);

  const onEditorialNotesChange = useCallback((value: string) => {
    const v = value.slice(0, MAX_CAROUSEL_FOCUS_CHARS);
    setEditorialNotes(v);
    setShortEditorialNotesToStorage(v);
  }, []);

  const updatePipeline = useCallback(
    (patch: Partial<StudioShortPipelineSettings>) => {
      setPipeline((prev) => {
        const next: StudioShortPipelineSettings = {
          ...prev,
          ...patch,
          reframe: patch.reframe
            ? { ...prev.reframe, ...patch.reframe }
            : prev.reframe,
        };
        setStudioShortPipelineSettingsToStorage(next);
        return next;
      });
    },
    []
  );

  const buildReprocessOptions = useCallback(
    (): StudioShortTextOptions => ({
      hook_instructions: hookInstructions.trim() || undefined,
      hook_overlay_text: hookOverlayText.trim() || undefined,
      editorial_notes: editorialNotes.trim() || undefined,
      pipeline,
    }),
    [hookInstructions, hookOverlayText, editorialNotes, pipeline]
  );

  const handleReprocess = useCallback(async () => {
    await onReprocess(buildReprocessOptions());
  }, [onReprocess, buildReprocessOptions]);

  return (
    <details className="rounded-lg border border-stone-300 bg-stone-50/90 shadow-sm [&>summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-stone-900">
        <span>Edit</span>
        <span className="text-xs font-normal text-stone-500" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="space-y-4 border-t border-stone-200 bg-white p-3">
        <fieldset className="space-y-2.5" disabled={busy}>
          <legend className="text-xs font-semibold uppercase tracking-wide text-stone-600">
            Copy &amp; hook
          </legend>
          <label className="block" htmlFor={hookId}>
            <span className="mb-1 block text-xs font-medium text-stone-700">
              Hook instructions{" "}
              <span className="font-normal text-stone-500">(optional)</span>
            </span>
            <textarea
              id={hookId}
              value={hookInstructions}
              onChange={(e) => setHookInstructions(e.target.value)}
              rows={2}
              placeholder="Steer opening framing or hook tone…"
              className="w-full resize-y rounded-md border border-stone-200 px-2 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-palette-teal focus:outline-none focus:ring-1 focus:ring-palette-teal disabled:bg-stone-100"
            />
          </label>
          <label className="block" htmlFor={overlayId}>
            <span className="mb-1 block text-xs font-medium text-stone-700">
              On-screen hook text{" "}
              <span className="font-normal text-stone-500">(optional)</span>
            </span>
            <textarea
              id={overlayId}
              value={hookOverlayText}
              onChange={(e) => setHookOverlayText(e.target.value)}
              rows={3}
              placeholder="Exact lines on the video; if set, skips AI hook text for those lines."
              className="w-full resize-y rounded-md border border-stone-200 px-2 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-palette-teal focus:outline-none focus:ring-1 focus:ring-palette-teal disabled:bg-stone-100"
            />
          </label>
          <label className="block" htmlFor={editorialId}>
            <span className="mb-1 block text-xs font-medium text-stone-700">
              Editorial notes for AI{" "}
              <span className="font-normal text-stone-500">(optional)</span>
            </span>
            <textarea
              id={editorialId}
              value={editorialNotes}
              onChange={(e) => onEditorialNotesChange(e.target.value)}
              rows={3}
              placeholder="Guide smart editorial cuts (what to trim or keep)…"
              className="w-full resize-y rounded-md border border-stone-200 px-2 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-palette-teal focus:outline-none focus:ring-1 focus:ring-palette-teal disabled:bg-stone-100"
            />
          </label>
        </fieldset>

        <fieldset className="space-y-2.5" disabled={busy}>
          <legend className="text-xs font-semibold uppercase tracking-wide text-stone-600">
            Pipeline
          </legend>
            <p className="text-[11px] leading-snug text-stone-500">
            {pipeline.devMode
              ? "Faster preview audio. Turn this off under Advanced for cleaner audio on the next run."
              : "Cleaner audio and your saved audio choice apply on re-process and your next upload."}
          </p>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-stone-800">
            <input
              type="checkbox"
              checked={pipeline.smartEditorial}
              onChange={(e) =>
                updatePipeline({ smartEditorial: e.target.checked })
              }
              className="mt-0.5 h-4 w-4 rounded border-stone-300 text-palette-moss focus:ring-palette-teal"
            />
            <span>
              <span className="font-medium">Smart editorial</span>
              <span className="mt-0.5 block text-xs text-stone-500">
                Trim filler, false starts, repetition, and dead air.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-stone-800">
            <input
              type="checkbox"
              checked={pipeline.bookendZoom}
              onChange={(e) =>
                updatePipeline({ bookendZoom: e.target.checked })
              }
              className="mt-0.5 h-4 w-4 rounded border-stone-300 text-palette-moss focus:ring-palette-teal"
            />
            <span>
              <span className="font-medium">Intro / outro bookend zoom</span>
              <span className="mt-0.5 block text-xs text-stone-500">
                Slight zoom on the opening and closing beats.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-stone-800">
            <input
              type="checkbox"
              checked={pipeline.smartReframe}
              onChange={(e) =>
                updatePipeline({ smartReframe: e.target.checked })
              }
              className="mt-0.5 h-4 w-4 rounded border-stone-300 text-palette-moss focus:ring-palette-teal"
            />
            <span>
              <span className="font-medium">Smart reframe</span>
              <span className="mt-0.5 block text-xs text-stone-500">
                Follow the speaker; tighter crop in the first seconds.
              </span>
            </span>
          </label>

          <details className="rounded-md border border-stone-200 bg-stone-50/80 px-2.5 py-2 [&>summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-stone-600">
              Advanced pipeline
              <span className="ml-1 font-normal normal-case tracking-normal text-stone-400">
                ▾
              </span>
            </summary>
            <div className="mt-2.5 space-y-2.5 border-t border-stone-200 pt-2.5">
              <label className="flex cursor-pointer items-start gap-2 text-sm text-stone-800">
                <input
                  type="checkbox"
                  checked={pipeline.devMode}
                  onChange={(e) =>
                    updatePipeline({ devMode: e.target.checked })
                  }
                  className="mt-0.5 h-4 w-4 rounded border-stone-300 text-palette-moss focus:ring-palette-teal"
                />
                <span>
                  <span className="font-medium">Dev mode</span>
                  <span className="mt-0.5 block text-xs text-stone-500">
                    Faster preview audio while you iterate. Uncheck for cleaner
                    audio on the next run.
                  </span>
                </span>
              </label>
              {!pipeline.devMode ? (
                <label className="block" htmlFor={audioId}>
                  <span className="mb-1 block text-xs font-medium text-stone-700">
                    Audio cleanup
                  </span>
                  <select
                    id={audioId}
                    value={pipeline.audioMode}
                    onChange={(e) => {
                      const mode = parseShortAudioMode(e.target.value);
                      if (mode) updatePipeline({ audioMode: mode });
                    }}
                    className="w-full rounded-md border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900 focus:border-palette-teal focus:outline-none focus:ring-1 focus:ring-palette-teal disabled:bg-stone-100"
                  >
                    <option value="deepfilter">Cleaner (recommended)</option>
                    <option value="fast">Fast (light cleanup)</option>
                    <option value="original">Original (no enhancement)</option>
                  </select>
                </label>
              ) : null}
            </div>
          </details>
        </fieldset>

        {!shortJobId ? (
          <p className="text-xs text-amber-800">
            Re-upload this video to enable re-process (job id required on the
            Short server).
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setAdvancedOpen(true)}
            disabled={busy || !shortJobId || !pipeline.smartEditorial}
            title={
              !pipeline.smartEditorial
                ? "Turn on Smart editorial in Pipeline to edit the timeline"
                : undefined
            }
            className="w-full rounded-lg border border-stone-300 bg-white py-2.5 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-1"
          >
            Advanced
          </button>
          <button
            type="button"
            onClick={() => void handleReprocess()}
            disabled={busy || !shortJobId}
            className="w-full rounded-lg bg-palette-moss py-2.5 text-sm font-semibold text-white transition hover:bg-palette-depth disabled:cursor-not-allowed disabled:opacity-50 sm:flex-1"
          >
            {busy ? "Re-processing…" : "Re-process short"}
          </button>
        </div>
      </div>
      {shortJobId ? (
        <ShortTimelineAdvancedModal
          open={advancedOpen}
          onClose={() => setAdvancedOpen(false)}
          shortJobId={shortJobId}
          busy={busy}
          outputPreviewUrl={shortPreviewUrl}
          buildReprocessOptions={buildReprocessOptions}
          onReprocess={onReprocess}
        />
      ) : null}
    </details>
  );
}
