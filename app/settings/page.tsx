"use client";

import { ContentMultiplierHomeLink } from "@/app/components/ContentMultiplierMark";
import { CollapsibleSection } from "@/app/components/CollapsibleSection";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_COPY_CONTEXT_CHARS,
  getCopyContextFromStorage,
  setCopyContextToStorage,
} from "@/lib/copy-context";
import {
  MAX_COPY_FEEDBACK_CHARS,
  getCopyFeedbackFromStorage,
  setCopyFeedbackToStorage,
} from "@/lib/copy-feedback";
import {
  MAX_REFERENCE_SOURCES_CHARS,
  getReferenceSourcesFromStorage,
  setReferenceSourcesToStorage,
} from "@/lib/reference-sources";
import {
  MAX_LEARNED_STORE_CHARS,
  clearLearnedFromEdits,
  getLearnedFromEditsBlob,
} from "@/lib/learned-from-edits";
import {
  getDefaultCaptionCtaFromStorage,
  MAX_DEFAULT_CAPTION_CTA_CHARS,
  setDefaultCaptionCtaToStorage,
} from "@/lib/default-caption-cta";
export default function SettingsPage() {
  const contextFileInputRef = useRef<HTMLInputElement>(null);
  const sourcesFileInputRef = useRef<HTMLInputElement>(null);

  const [draftContext, setDraftContext] = useState("");
  const [draftSources, setDraftSources] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const [defaultCaptionCta, setDefaultCaptionCta] = useState("");
  const [learnedFromEditsLog, setLearnedFromEditsLog] = useState("");

  useEffect(() => {
    setDraftContext(getCopyContextFromStorage());
    setDraftSources(getReferenceSourcesFromStorage());
    setCopyFeedback(getCopyFeedbackFromStorage());
    setDefaultCaptionCta(getDefaultCaptionCtaFromStorage());
    setLearnedFromEditsLog(getLearnedFromEditsBlob());
  }, []);

  const handleContextFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const t =
          typeof reader.result === "string"
            ? reader.result
            : new TextDecoder().decode(reader.result as ArrayBuffer);
        setDraftContext(t.slice(0, MAX_COPY_CONTEXT_CHARS));
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    []
  );

  const handleSourcesFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const t =
          typeof reader.result === "string"
            ? reader.result
            : new TextDecoder().decode(reader.result as ArrayBuffer);
        setDraftSources(t.slice(0, MAX_REFERENCE_SOURCES_CHARS));
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    []
  );

  const onFeedbackChange = useCallback((value: string) => {
    const v = value.slice(0, MAX_COPY_FEEDBACK_CHARS);
    setCopyFeedback(v);
    setCopyFeedbackToStorage(v);
  }, []);

  const onDefaultCaptionCtaChange = useCallback((value: string) => {
    const v = value.slice(0, MAX_DEFAULT_CAPTION_CTA_CHARS);
    setDefaultCaptionCta(v);
    setDefaultCaptionCtaToStorage(v);
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 pb-20">
      <ContentMultiplierHomeLink className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-palette-depth hover:text-stone-900" />
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-stone-900">Settings</h1>
      </div>

      <div className="space-y-10">
        <section className="rounded-2xl border border-stone-200/80 bg-white/90 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-stone-900">
            Default caption CTA (optional)
          </h2>
          <p className="mt-2 text-sm text-stone-600">
            When you upload a video and the app generates a caption, this line is
            added at the end of the main caption, before the hashtag block. Stored
            only in your browser.
          </p>
          <textarea
            id="default-caption-cta-settings"
            value={defaultCaptionCta}
            onChange={(e) => onDefaultCaptionCtaChange(e.target.value)}
            rows={3}
            placeholder='e.g. "Train with us - link in bio"'
            className="mt-4 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm placeholder:text-stone-400"
          />
          <p className="mt-1 text-xs text-stone-400">
            {defaultCaptionCta.length.toLocaleString()} /{" "}
            {MAX_DEFAULT_CAPTION_CTA_CHARS.toLocaleString()} · Saved automatically
          </p>
        </section>

        <section className="rounded-2xl border border-stone-200/80 bg-white/90 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-stone-900">
            Notes for the next AI run (optional)
          </h2>
          <textarea
            id="copy-feedback-settings"
            value={copyFeedback}
            onChange={(e) => onFeedbackChange(e.target.value)}
            rows={5}
            placeholder='e.g. "Shorter hook", "less hype", "spell out Step 2 more"'
            className="mt-4 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm placeholder:text-stone-400"
          />
          <p className="mt-1 text-xs text-stone-400">
            {copyFeedback.length.toLocaleString()} /{" "}
            {MAX_COPY_FEEDBACK_CHARS.toLocaleString()} · Saved automatically
          </p>
        </section>

        <CollapsibleSection title="Context for copy">
          <p className="text-sm text-stone-600">
            Brand voice, audience, facts. Used for carousel slides and image-post
            copy; stored only in your browser.
          </p>

          <div className="mt-4">
            <input
              ref={contextFileInputRef}
              type="file"
              accept=".txt,.md,.text,text/plain"
              className="hidden"
              onChange={handleContextFile}
            />
            <button
              type="button"
              onClick={() => contextFileInputRef.current?.click()}
              className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-3 text-sm font-medium text-stone-800 hover:bg-stone-100"
            >
              Upload context file (.txt, .md)
            </button>
          </div>

          <label className="mt-4 block text-sm font-medium text-stone-700">
            Or edit here
          </label>
          <textarea
            value={draftContext}
            onChange={(e) =>
              setDraftContext(e.target.value.slice(0, MAX_COPY_CONTEXT_CHARS))
            }
            rows={8}
            className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
            placeholder="Paste or upload context above…"
          />
          <p className="mt-1 text-xs text-stone-500">
            {draftContext.length} / {MAX_COPY_CONTEXT_CHARS}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setDraftContext("");
                setCopyContextToStorage("");
              }}
              className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setCopyContextToStorage(draftContext)}
              className="rounded-lg bg-palette-moss px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-palette-depth hover:text-stone-950"
            >
              Save context
            </button>
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Reference sources">
          <p className="text-sm text-stone-600">
            Excerpts from coaches, articles, or your notes. The model uses this
            to expand the caption when your clip is short  -  the transcript still
            defines what the video says.
          </p>

          <div className="mt-4">
            <input
              ref={sourcesFileInputRef}
              type="file"
              accept=".txt,.md,.text,text/plain"
              className="hidden"
              onChange={handleSourcesFile}
            />
            <button
              type="button"
              onClick={() => sourcesFileInputRef.current?.click()}
              className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-3 text-sm font-medium text-stone-800 hover:bg-stone-100"
            >
              Upload sources file (.txt, .md)
            </button>
          </div>

          <label className="mt-4 block text-sm font-medium text-stone-700">
            Or paste here
          </label>
          <textarea
            value={draftSources}
            onChange={(e) =>
              setDraftSources(
                e.target.value.slice(0, MAX_REFERENCE_SOURCES_CHARS)
              )
            }
            rows={12}
            className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 font-mono text-sm"
            placeholder="e.g. bullet cues, training notes…"
          />
          <p className="mt-1 text-xs text-stone-500">
            {draftSources.length} / {MAX_REFERENCE_SOURCES_CHARS}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setDraftSources("");
                setReferenceSourcesToStorage("");
              }}
              className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setReferenceSourcesToStorage(draftSources)}
              className="rounded-lg bg-palette-moss px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-palette-depth hover:text-stone-950"
            >
              Save sources
            </button>
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Learned from your edits (auto)">
          <p className="text-sm text-stone-600">
            When you finish carousel text and click{" "}
            <strong className="font-medium text-stone-800">
              Rebuild slide images
            </strong>
            , or save image-post changes with{" "}
            <strong className="font-medium text-stone-800">
              Rebuild image &amp; save
            </strong>
            , the app records short before/after lines here. They are{" "}
            <strong className="font-medium text-stone-800">
              merged into copy context
            </strong>{" "}
            on the next carousel or image-post generation (same browser; survives
            closing the tab). Clear anytime if the log gets noisy.
          </p>
          <textarea
            readOnly
            value={learnedFromEditsLog}
            rows={10}
            className="mt-3 w-full rounded-lg border border-stone-200 bg-stone-50/80 px-3 py-2 font-mono text-xs leading-relaxed text-stone-800"
            aria-label="Auto-captured edit learnings log"
          />
          <p className="mt-1 text-xs text-stone-500">
            {learnedFromEditsLog.length.toLocaleString()} /{" "}
            {MAX_LEARNED_STORE_CHARS.toLocaleString()} characters (oldest dropped
            when over limit)
          </p>
          <button
            type="button"
            onClick={() => {
              clearLearnedFromEdits();
              setLearnedFromEditsLog("");
            }}
            className="mt-3 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
          >
            Clear learnings log
          </button>
        </CollapsibleSection>
      </div>
    </main>
  );
}
