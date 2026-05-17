"use client";

import { useCallback, useEffect, useState } from "react";

export type CarouselPreviewPlatform = "youtube" | "instagram";

type Props = {
  slideBase64s: string[];
  className?: string;
  /** Live CSS `filter` preview (e.g. from `frameColorAdjustToCssFilter`). */
  colorPreviewFilter?: string;
  /** 1:1 vs 4:5 framing for layout (image aspect comes from PNG). */
  previewPlatform?: CarouselPreviewPlatform;
};

export function CarouselSlideViewer({
  slideBase64s,
  className = "",
  colorPreviewFilter,
  previewPlatform = "youtube",
}: Props) {
  const n = slideBase64s.length;
  const [index, setIndex] = useState(0);

  // Depend only on `n`: parents often pass `preview ?? []`, which is a new [] each render.
  useEffect(() => {
    setIndex((i) => (n === 0 ? 0 : Math.min(i, n - 1)));
  }, [n]);

  const go = useCallback(
    (delta: number) => {
      if (n === 0) return;
      setIndex((i) => (i + delta + n) % n);
    },
    [n]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target as Node | null;
      if (
        el &&
        el instanceof Element &&
        el.closest(
          "input, textarea, select, [contenteditable=true], [contenteditable='']"
        )
      ) {
        return;
      }
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (n === 0) {
    return (
      <p className="text-sm text-stone-600">No slide images to preview.</p>
    );
  }

  const src = `data:image/png;base64,${slideBase64s[index]}`;

  /** Same max width for 1:1 and 4:5 so preview scale matches exports (both 1080px wide). */
  const slideFrameOuter = "max-w-[min(480px,96vw)]";
  const slideFrameInner = "max-w-[min(420px,85vw)]";

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className={`w-full ${slideFrameOuter}`}>
        <div className={`mx-auto ${slideFrameInner}`}>
          <div
            className="overflow-hidden rounded-xl"
            style={
              colorPreviewFilter
                ? { filter: colorPreviewFilter }
                : undefined
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={src}
              src={src}
              alt={`Slide ${index + 1} of ${n} (${
                previewPlatform === "instagram" ? "4:5" : "1:1"
              })`}
              className="w-full rounded-xl border border-stone-200 bg-stone-100 shadow-lg shadow-stone-300/50"
            />
          </div>
        </div>
      </div>
      {n > 1 && (
        <div className="mt-4 flex w-full justify-center">
          <div className="inline-flex items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={() => go(-1)}
              className="shrink-0 rounded-full bg-transparent px-2 py-1 text-2xl font-extrabold leading-none text-stone-900 transition hover:text-stone-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-palette-moss/45 sm:px-2.5 sm:py-1.5 sm:text-3xl"
              aria-label="Previous slide"
            >
              ‹
            </button>
            <div className="flex max-w-[min(280px,70vw)] flex-wrap items-center justify-center gap-2 px-0.5">
              {slideBase64s.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={`h-2.5 w-2.5 shrink-0 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-palette-moss/45 ${
                    i === index
                      ? "bg-palette-moss"
                      : "bg-stone-400 hover:bg-stone-500"
                  }`}
                  aria-label={`Go to slide ${i + 1}`}
                  aria-current={i === index}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => go(1)}
              className="shrink-0 rounded-full bg-transparent px-2 py-1 text-2xl font-extrabold leading-none text-stone-900 transition hover:text-stone-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-palette-moss/45 sm:px-2.5 sm:py-1.5 sm:text-3xl"
              aria-label="Next slide"
            >
              ›
            </button>
          </div>
        </div>
      )}
      <p className="mt-2 text-sm text-stone-600">
        Slide {index + 1} of {n}
      </p>
    </div>
  );
}
