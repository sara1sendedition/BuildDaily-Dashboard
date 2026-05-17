"use client";

import Link from "next/link";

export type FrameToneReviewVariant = "carousel" | "image";

type FrameToneReviewCardProps = {
  variant?: FrameToneReviewVariant;
  /** Preview image src, e.g. `data:image/png;base64,...` */
  previewSrc: string;
  /** Live CSS filter preview (optional). */
  colorPreviewFilter?: string;
  onApply: () => void;
  busy: boolean;
  disabled?: boolean;
};

/**
 * Rebuild slide/photo PNG from the current video frame and on-image text.
 * Keyframes use unmodified FFmpeg scale/crop (no color grading).
 */
export function FrameToneReviewCard({
  variant = "carousel",
  previewSrc,
  colorPreviewFilter,
  onApply,
  busy,
  disabled = false,
}: FrameToneReviewCardProps) {
  const isImage = variant === "image";
  const titleId = isImage
    ? "frame-preview-rebuild-title-image"
    : "frame-preview-rebuild-title-carousel";
  const applyLabel = isImage ? "Rebuild photo" : "Rebuild slides";

  return (
    <section
      className="rounded-xl border border-palette-moss/50 bg-gradient-to-br from-palette-pale/30 to-white p-4 shadow-sm"
      aria-labelledby={titleId}
    >
      <h3 id={titleId} className="text-sm font-semibold text-stone-900">
        {isImage ? "Preview image" : "Preview first slide"}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-stone-600">
        {isImage
          ? "Background is a direct frame from your video (or uploaded still), scaled to 4:5. Optional color tweaks live under the main preview. Adjust copy in "
          : "Backgrounds are direct video frames, scaled and cropped. Optional color under the preview. Edit text in "}
        <Link
          href="/settings"
          className="font-medium text-palette-depth underline decoration-palette-depth/35 underline-offset-2 hover:text-stone-900"
        >
          Settings
        </Link>
        {isImage ? ", then rebuild if the hook or layout needs a refresh." : ", then rebuild all slide PNGs when you are ready."}
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-100 shadow-inner">
          <div
            className="h-full w-full"
            style={
              colorPreviewFilter ? { filter: colorPreviewFilter } : undefined
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewSrc}
              alt={
                isImage
                  ? "Image post preview"
                  : "First slide preview for rebuild"
              }
              className="h-full w-full object-cover"
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <button
            type="button"
            onClick={() => onApply()}
            disabled={disabled || busy}
            className="w-full rounded-lg bg-palette-moss px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-palette-depth disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {busy
              ? isImage
                ? "Rebuilding photo…"
                : "Rebuilding slides…"
              : applyLabel}
          </button>
          <p className="text-[11px] leading-snug text-stone-500">
            {isImage
              ? "Same API as Edit text → Rebuild image & save: redraws PNG from the frame and overlay."
              : "Same as Edit carousel → Rebuild slide images: uses current slide text and your video."}
          </p>
        </div>
      </div>
    </section>
  );
}
