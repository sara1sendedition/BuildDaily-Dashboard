"use client";

import { useId, useState, type ReactNode } from "react";
import {
  CAROUSEL_LABELS,
  POST_STYLE_TYPE_ORDER,
  useCarouselWorkspace,
} from "@/context/carousel-workspace-context";
import type { CarouselType, LayoutId } from "@/lib/types";
import { CollapsibleSection } from "@/app/components/CollapsibleSection";

type FolderTab = "design" | "copy";

type RefinePanelProps = {
  /** When true, hide the ZIP download (e.g. home studio has its own download row). */
  hideZipDownload?: boolean;
  /** When true, wrap the whole editor in a collapsible section (starts closed). */
  collapseInAccordion?: boolean;
  /** Title for the outer accordion when collapseInAccordion is true. */
  accordionTitle?: string;
  /** Rendered inside the accordion above the editor (e.g. link to full-screen refine). */
  accordionTopSlot?: ReactNode;
};

export function RefinePanel({
  hideZipDownload = false,
  collapseInAccordion = false,
  accordionTitle = "Edit carousel",
  accordionTopSlot,
}: RefinePanelProps = {}) {
  const [activeFolder, setActiveFolder] = useState<FolderTab>("copy");
  const designTabId = useId();
  const copyTabId = useId();
  const designPanelId = useId();
  const copyPanelId = useId();

  const {
    layoutId,
    setLayoutId,
    carouselOverride,
    setCarouselOverride,
    backgroundSource,
    setBackgroundSource,
    backgroundFile,
    setBackgroundFile,
    backgroundInputRef,
    loading,
    editableSlides,
    updateSlide,
    removeSlide,
    addSlide,
    moveSlide,
    reRenderLoading,
    file,
    fileInputRef,
    generateCarousel,
    reRenderZip,
    downloadZip,
    zipBase64,
  } = useCarouselWorkspace();

  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const panel = (
    <div className="space-y-6">
      <div className="flex flex-col shadow-sm">
        <div
          className="flex items-end gap-0"
          role="tablist"
          aria-label="Edit sections"
        >
          <button
            id={copyTabId}
            type="button"
            role="tab"
            aria-selected={activeFolder === "copy"}
            aria-controls={copyPanelId}
            tabIndex={activeFolder === "copy" ? 0 : -1}
            onClick={() => setActiveFolder("copy")}
            className={`relative min-w-0 flex-1 px-3 py-2 text-left text-sm font-semibold transition sm:px-4 sm:py-2.5 ${
              activeFolder === "copy"
                ? "z-10 -mb-px rounded-tl-xl border-l border-t border-r border-palette-moss border-b-white bg-white py-2.5 text-stone-900 shadow-sm sm:py-3"
                : "rounded-tl-xl border border-palette-moss bg-stone-100/85 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            <span className="block truncate">Text</span>
            <span className="mt-0.5 block text-[11px] font-normal text-stone-500 sm:text-xs">
              Headlines &amp; body per slide
            </span>
          </button>
          <button
            id={designTabId}
            type="button"
            role="tab"
            aria-selected={activeFolder === "design"}
            aria-controls={designPanelId}
            tabIndex={activeFolder === "design" ? 0 : -1}
            onClick={() => setActiveFolder("design")}
            className={`relative min-w-0 flex-1 px-3 py-2 text-left text-sm font-semibold transition sm:px-4 sm:py-2.5 ${
              activeFolder === "design"
                ? "z-10 -mb-px rounded-tr-xl border-t border-r border-palette-moss border-b-white bg-white py-2.5 text-stone-900 shadow-sm sm:py-3"
                : "rounded-tr-xl border-b border-r border-t border-palette-moss bg-stone-100/85 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            <span className="block truncate">Style</span>
            <span className="mt-0.5 block text-[11px] font-normal text-stone-500 sm:text-xs">
              Layout, background, post type
            </span>
          </button>
        </div>

        <div
          id={copyPanelId}
          role="tabpanel"
          aria-labelledby={copyTabId}
          hidden={activeFolder !== "copy"}
          className="relative z-0 rounded-b-xl border-b border-l border-r border-palette-moss bg-white p-4 sm:p-5"
        >
          {editableSlides.length > 0 ? (
            <div>
              <p className="mb-4 text-xs text-stone-500">
                Drag the handle or use the arrows to reorder slides.
              </p>
              <div className="space-y-6">
                {editableSlides.map((s, i) => (
                  <div
                    key={s.order}
                    className={`rounded-lg transition-colors ${
                      dragOverIndex === i && dragFromIndex !== i
                        ? "bg-stone-50 ring-2 ring-palette-moss/35"
                        : ""
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragFromIndex !== null && dragFromIndex !== i) {
                        setDragOverIndex(i);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverIndex === i) setDragOverIndex(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragFromIndex !== null && dragFromIndex !== i) {
                        moveSlide(dragFromIndex, i);
                      }
                      setDragFromIndex(null);
                      setDragOverIndex(null);
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          draggable
                          onDragStart={() => setDragFromIndex(i)}
                          onDragEnd={() => {
                            setDragFromIndex(null);
                            setDragOverIndex(null);
                          }}
                          className="shrink-0 cursor-grab rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-palette-moss/35"
                          aria-label={`Drag to reorder slide ${i + 1}`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="h-5 w-5"
                            aria-hidden
                          >
                            <circle cx="9" cy="7" r="1.5" />
                            <circle cx="15" cy="7" r="1.5" />
                            <circle cx="9" cy="12" r="1.5" />
                            <circle cx="15" cy="12" r="1.5" />
                            <circle cx="9" cy="17" r="1.5" />
                            <circle cx="15" cy="17" r="1.5" />
                          </svg>
                        </button>
                        <p className="text-sm font-semibold text-stone-800">
                          Slide {i + 1}:
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          disabled={i === 0}
                          onClick={() => moveSlide(i, i - 1)}
                          className="rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:pointer-events-none disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-palette-moss/35"
                          aria-label={`Move slide ${i + 1} up`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                            aria-hidden
                          >
                            <path d="m18 15-6-6-6 6" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          disabled={i === editableSlides.length - 1}
                          onClick={() => moveSlide(i, i + 1)}
                          className="rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:pointer-events-none disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-palette-moss/35"
                          aria-label={`Move slide ${i + 1} down`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                            aria-hidden
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSlide(i)}
                          className="rounded-md p-1.5 text-stone-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/35"
                          aria-label={`Delete slide ${i + 1}`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-5 w-5"
                            aria-hidden
                          >
                            <path d="M3 6h18" />
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            <line x1="10" x2="10" y1="11" y2="17" />
                            <line x1="14" x2="14" y1="11" y2="17" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <label
                      className="sr-only"
                      htmlFor={`refine-headline-${s.order}`}
                    >
                      Slide {i + 1} headline
                    </label>
                    <textarea
                      id={`refine-headline-${s.order}`}
                      className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 font-medium text-stone-900 shadow-sm"
                      rows={2}
                      value={s.headline}
                      onChange={(e) =>
                        updateSlide(i, "headline", e.target.value)
                      }
                    />
                    <label
                      className="sr-only"
                      htmlFor={`refine-body-${s.order}`}
                    >
                      Slide {i + 1} body
                    </label>
                    <textarea
                      id={`refine-body-${s.order}`}
                      className="mt-2 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 shadow-sm"
                      rows={2}
                      value={s.body ?? ""}
                      onChange={(e) => updateSlide(i, "body", e.target.value)}
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => addSlide()}
                className="mt-6 inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800 shadow-sm transition hover:bg-stone-50"
              >
                <span className="text-base font-semibold leading-none" aria-hidden>
                  +
                </span>
                Add slide
              </button>
              <button
                type="button"
                disabled={
                  loading ||
                  reRenderLoading ||
                  !(file ?? fileInputRef.current?.files?.[0])
                }
                onClick={() => void reRenderZip()}
                className="mt-3 w-full rounded-xl border border-stone-300 bg-stone-200 py-3 text-sm font-semibold text-stone-900 hover:bg-stone-300 disabled:opacity-50"
              >
                {reRenderLoading ? "Updating…" : "Rebuild slide images"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-stone-600">
                Slide copy appears here after a carousel is generated. Use{" "}
                <strong className="font-medium text-stone-800">Style</strong>{" "}
                and <strong className="font-medium text-stone-800">Regenerate carousel (AI)</strong>{" "}
                first if you don&apos;t see slides yet.
              </p>
              <button
                type="button"
                onClick={() => addSlide()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800 shadow-sm transition hover:bg-stone-50"
              >
                <span
                  className="text-base font-semibold leading-none"
                  aria-hidden
                >
                  +
                </span>
                Add slide
              </button>
            </div>
          )}
        </div>

        <div
          id={designPanelId}
          role="tabpanel"
          aria-labelledby={designTabId}
          hidden={activeFolder !== "design"}
          className="relative z-0 rounded-b-xl border-b border-l border-r border-palette-moss bg-white p-4 sm:p-5"
        >
          <div className="space-y-3">
            <CollapsibleSection title="Background images">
              <div className="space-y-6">
                <div>
                  <div
                    className="flex flex-col gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 sm:flex-row sm:gap-0"
                    role="group"
                    aria-label="Background source"
                  >
                    <button
                      type="button"
                      onClick={() => setBackgroundSource("video_moments")}
                      className={`flex-1 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors sm:text-center ${
                        backgroundSource === "video_moments"
                          ? "bg-palette-moss text-white shadow-sm"
                          : "text-stone-600 hover:text-stone-900"
                      }`}
                    >
                      Use moments from within the video
                    </button>
                    <button
                      type="button"
                      onClick={() => setBackgroundSource("own_background")}
                      className={`flex-1 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors sm:text-center ${
                        backgroundSource === "own_background"
                          ? "bg-palette-moss text-white shadow-sm"
                          : "text-stone-600 hover:text-stone-900"
                      }`}
                    >
                      Upload my own background
                    </button>
                  </div>
                  {backgroundSource === "own_background" && (
                    <div className="mt-4">
                      <label className="block text-xs font-medium text-stone-600">
                        Background image
                      </label>
                      <p className="mt-1 text-xs text-stone-600">
                        PNG, JPEG, or WebP. Re-choose when re-rendering to keep
                        it.
                      </p>
                      <input
                        id="carousel-background-refine"
                        ref={backgroundInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        onChange={(e) =>
                          setBackgroundFile(e.target.files?.[0] ?? null)
                        }
                      />
                      <label
                        htmlFor="carousel-background-refine"
                        className="mt-2 inline-flex cursor-pointer rounded-lg bg-stone-200 px-4 py-2 text-sm font-medium text-stone-800 transition hover:bg-stone-300"
                      >
                        {backgroundFile ? "Change file" : "Choose file"}
                      </label>
                      {backgroundFile && (
                        <p className="mt-2 text-sm text-stone-600">
                          Selected:{" "}
                          <span className="text-stone-900">
                            {backgroundFile.name}
                          </span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Layout">
              <div>
                <label htmlFor="refine-layout-select" className="sr-only">
                  Layout
                </label>
                <select
                  id="refine-layout-select"
                  className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-900 shadow-sm"
                  value={layoutId}
                  onChange={(e) => setLayoutId(e.target.value as LayoutId)}
                >
                  <option value="stacked_center">Stacked center</option>
                  <option value="split_lower_third">Lower third</option>
                </select>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Post Type">
              <div>
                <label htmlFor="refine-post-type-select" className="sr-only">
                  Post Type
                </label>
                <select
                  id="refine-post-type-select"
                  className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-900 shadow-sm"
                  value={carouselOverride}
                  onChange={(e) =>
                    setCarouselOverride(
                      (e.target.value || "") as CarouselType | ""
                    )
                  }
                >
                  <option value="">Auto (recommended)</option>
                  {POST_STYLE_TYPE_ORDER.map((k) => (
                    <option key={k} value={k}>
                      {CAROUSEL_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
            </CollapsibleSection>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void generateCarousel({ defaultsOnly: false })}
            className="mt-5 w-full rounded-xl border border-palette-teal bg-palette-pale/25 py-3 text-sm font-semibold text-stone-800 transition hover:bg-palette-pale/45 disabled:opacity-50"
          >
            {loading ? "Updating…" : "Regenerate carousel (AI)"}
          </button>
          <p className="mt-1.5 text-center text-[11px] leading-snug text-stone-500">
            Re-runs slide copy from the model; your manual text edits in the
            Text tab can be replaced.
          </p>
        </div>
      </div>

      {zipBase64 && !hideZipDownload && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={downloadZip}
            className="rounded-xl bg-palette-moss px-6 py-3 text-sm font-semibold text-white hover:bg-palette-depth"
          >
            Download ZIP
          </button>
        </div>
      )}
    </div>
  );

  if (collapseInAccordion) {
    return (
      <CollapsibleSection title={accordionTitle} defaultOpen={false}>
        {accordionTopSlot ? <div className="mb-3">{accordionTopSlot}</div> : null}
        {panel}
      </CollapsibleSection>
    );
  }
  return panel;
}
