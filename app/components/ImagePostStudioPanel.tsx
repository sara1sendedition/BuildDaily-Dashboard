"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollapsibleSection } from "@/app/components/CollapsibleSection";
import { DismissableHint } from "@/app/components/DismissableHint";
import { FrameColorAdjustSliders } from "@/app/components/FrameColorAdjustSliders";
import { useCarouselWorkspace } from "@/context/carousel-workspace-context";
import {
  appendLearnedFromEditsLines,
  buildImagePostLearningLines,
} from "@/lib/learned-from-edits";
import { frameColorAdjustToCssFilter } from "@/lib/frame-color-adjust";

export function ImagePostStudioPanel() {
  const {
    activeQueueId,
    imagePost,
    imagePostError,
    imagePostBusy,
    file,
    patchImagePost,
    regenerateImagePostCopy,
    rerenderImagePostOverlay,
    frameColorAdjust,
    setFrameColorAdjust,
    applyImagePostFrameColor,
  } = useCarouselWorkspace();

  const [editOpen, setEditOpen] = useState(false);
  const [draftHook, setDraftHook] = useState("");
  const [draftMicro, setDraftMicro] = useState("");
  const [draftCaption, setDraftCaption] = useState("");
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [copiedAlt, setCopiedAlt] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const draftHookRef = useRef("");
  const draftMicroRef = useRef("");
  const draftCaptionRef = useRef("");
  /** Avoid re-seeding drafts on every `imagePost` update while the dialog is open (wiped typing + caption flicker during Apply). */
  const editDialogWasOpenRef = useRef(false);

  useEffect(() => {
    draftHookRef.current = draftHook;
    draftMicroRef.current = draftMicro;
    draftCaptionRef.current = draftCaption;
  }, [draftHook, draftMicro, draftCaption]);

  useEffect(() => {
    if (editOpen && !editDialogWasOpenRef.current && imagePost) {
      setDraftHook(imagePost.hook);
      setDraftMicro(imagePost.microCta);
      setDraftCaption(imagePost.caption);
      draftHookRef.current = imagePost.hook;
      draftMicroRef.current = imagePost.microCta;
      draftCaptionRef.current = imagePost.caption;
      setApplyError(null);
    }
    editDialogWasOpenRef.current = editOpen;
  }, [editOpen, imagePost]);

  const prevActiveQueueIdRef = useRef<string | null>(activeQueueId);
  useEffect(() => {
    const prev = prevActiveQueueIdRef.current;
    if (prev !== activeQueueId && editOpen) {
      setEditOpen(false);
    }
    prevActiveQueueIdRef.current = activeQueueId;
  }, [activeQueueId, editOpen]);

  const colorPreviewFilter = useMemo(
    () => frameColorAdjustToCssFilter(frameColorAdjust),
    [frameColorAdjust]
  );

  const applyEditedText = useCallback(async () => {
    if (!imagePost) return;
    setApplyError(null);
    const beforeText = {
      hook: imagePost.hook,
      microCta: imagePost.microCta,
      caption: imagePost.caption,
    };
    const hook = draftHookRef.current;
    const micro = draftMicroRef.current;
    const caption = draftCaptionRef.current;
    const imageNeeds =
      hook !== imagePost.hook || micro !== imagePost.microCta;

    if (imageNeeds && !file) {
      setApplyError(
        "To update text on the image, the original video file must still be available (re-upload from the queue if needed)."
      );
      return;
    }

    if (imageNeeds) {
      const ok = await rerenderImagePostOverlay(hook, micro);
      if (!ok) return;
    }
    patchImagePost({ hook, microCta: micro, caption });
    const afterText = { hook, microCta: micro, caption };
    const imgLines = buildImagePostLearningLines(beforeText, afterText);
    if (imgLines.length > 0) {
      appendLearnedFromEditsLines(imgLines);
    }
    setEditOpen(false);
  }, [imagePost, file, rerenderImagePostOverlay, patchImagePost]);

  if (imagePostError && !imagePost) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="font-medium">Image post unavailable</p>
        <p className="mt-1 text-amber-900/90">{imagePostError}</p>
        <button
          type="button"
          disabled={imagePostBusy || !file}
          onClick={() => void regenerateImagePostCopy()}
          className="mt-3 rounded-lg bg-palette-moss px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-palette-depth disabled:cursor-not-allowed disabled:opacity-50"
        >
          {imagePostBusy ? "Retrying…" : "Try again"}
        </button>
      </div>
    );
  }

  if (!imagePost) {
    return (
      <p className="text-sm text-stone-600">
        Image post will appear here after processing finishes.
      </p>
    );
  }

  const src = `data:image/png;base64,${imagePost.imageBase64}`;
  const imagePreviewKey =
    imagePost.imageBase64.length > 0
      ? `ip-${imagePost.imageBase64.length}-${imagePost.imageBase64.slice(0, 24)}-${imagePost.imageBase64.slice(-24)}`
      : "ip-empty";

  const copyAndEditSection = (
    <>
      <CollapsibleSection title="Caption" defaultOpen={false}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Feed caption
          </p>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(imagePost.caption);
              setCopiedCaption(true);
              setTimeout(() => setCopiedCaption(false), 2000);
            }}
            className="rounded-lg bg-palette-pale/50 px-3 py-1 text-xs font-medium text-stone-800 hover:bg-palette-pale"
          >
            {copiedCaption ? "Copied" : "Copy caption"}
          </button>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
          {imagePost.caption}
        </p>
      </CollapsibleSection>

      <CollapsibleSection title="Alt text (Instagram)" defaultOpen={false}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Accessibility
          </p>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(imagePost.altText);
              setCopiedAlt(true);
              setTimeout(() => setCopiedAlt(false), 2000);
            }}
            className="rounded-lg bg-palette-pale/50 px-3 py-1 text-xs font-medium text-stone-800 hover:bg-palette-pale"
          >
            {copiedAlt ? "Copied" : "Copy alt text"}
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-stone-700">
          {imagePost.altText}
        </p>
        <DismissableHint id="image-post-studio-alt-paste">
        <p className="mt-2 text-xs text-stone-500">
          Paste into the post&apos;s Accessibility → Alt text field when you
          publish.
        </p>
        </DismissableHint>
      </CollapsibleSection>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          disabled={imagePostBusy}
          className="rounded-xl border-2 border-palette-moss bg-palette-pale/70 px-6 py-2.5 text-sm font-semibold text-stone-900 shadow-sm hover:bg-palette-pale disabled:cursor-not-allowed disabled:opacity-50"
        >
          Edit text
        </button>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      {imagePostError ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {imagePostError}
        </p>
      ) : null}

      <div className="relative overflow-hidden rounded-2xl border border-stone-200 bg-stone-100 shadow-inner">
        <div
          className="flex justify-center"
          style={
            colorPreviewFilter ? { filter: colorPreviewFilter } : undefined
          }
        >
          <Image
            key={imagePreviewKey}
            src={src}
            alt={imagePost.altText || "Generated 4:5 Instagram post"}
            width={1080}
            height={1350}
            unoptimized
            className="max-h-[min(48vh,480px)] w-auto max-w-full object-contain"
          />
        </div>
        <button
          type="button"
          disabled={imagePostBusy || !file}
          onClick={() => void regenerateImagePostCopy()}
          aria-label="Regenerate image post with AI (replaces copy on image)"
          title="Regenerate image post with AI (replaces copy on image)"
          className="absolute right-2 top-2 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-stone-200/90 bg-white/95 text-palette-depth shadow-md backdrop-blur-sm transition hover:bg-palette-pale/80 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 0 6.74-2.74L21 4" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 20" />
            <path d="M3 21v-5h5" />
          </svg>
        </button>
      </div>

      <div className="space-y-6">{copyAndEditSection}</div>

      <CollapsibleSection title="Frame color">
        <FrameColorAdjustSliders
          idPrefix="image-post-studio"
          value={frameColorAdjust}
          onChange={setFrameColorAdjust}
          disabled={imagePostBusy}
        />
        <button
          type="button"
          disabled={imagePostBusy || !file}
          onClick={() => void applyImagePostFrameColor()}
          className="mt-4 w-full rounded-xl border border-palette-teal bg-palette-pale/25 py-2.5 text-sm font-semibold text-stone-800 transition hover:bg-palette-pale/45 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {imagePostBusy ? "Updating…" : "Apply color to image"}
        </button>
        <p className="mt-2 text-center text-[11px] leading-snug text-stone-500">
          Sliders update the preview. Use the button when you want the downloaded
          image to match.
        </p>
      </CollapsibleSection>

      {editOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="studio-edit-image-post-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]"
            onClick={() => !imagePostBusy && setEditOpen(false)}
            aria-label="Close"
          />
          <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
            <h2
              id="studio-edit-image-post-title"
              className="text-lg font-semibold text-stone-900"
            >
              Edit text
            </h2>
            <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
              Changing <strong className="font-medium text-stone-800">only</strong>{" "}
              the caption updates the caption card below the preview, not the
              large image. Change hook or subline (or both) to rebuild the image.
            </p>

            <label className="mt-4 block text-sm font-medium text-stone-700">
              Hook (on image)
            </label>
            <textarea
              value={draftHook}
              onChange={(e) => setDraftHook(e.target.value)}
              rows={3}
              disabled={imagePostBusy}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-stone-500">
              One line per visual row. Multi-color hooks use Settings → Visual
              references (Image post reference) line fills in order.
            </p>

            <label className="mt-4 block text-sm font-medium text-stone-700">
              Subline (on image)
            </label>
            <textarea
              value={draftMicro}
              onChange={(e) => setDraftMicro(e.target.value)}
              rows={2}
              disabled={imagePostBusy}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm disabled:opacity-60"
            />

            <label className="mt-4 block text-sm font-medium text-stone-700">
              Caption
            </label>
            <textarea
              value={draftCaption}
              onChange={(e) => setDraftCaption(e.target.value)}
              rows={10}
              disabled={imagePostBusy}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm leading-relaxed disabled:opacity-60"
            />

            {applyError ? (
              <p className="mt-3 text-sm text-red-700">{applyError}</p>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                disabled={imagePostBusy}
                className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void applyEditedText()}
                disabled={imagePostBusy}
                className="rounded-lg bg-palette-moss px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-palette-depth hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {imagePostBusy ? "Updating…" : "Rebuild image & save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
