"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { ContentMultiplierHomeLink } from "@/app/components/ContentMultiplierMark";
import { useRouter } from "next/navigation";
import {
  CarouselSlideViewer,
  type CarouselPreviewPlatform,
} from "@/app/components/CarouselSlideViewer";
import { CollapsibleSection } from "@/app/components/CollapsibleSection";
import { FrameColorAdjustSliders } from "@/app/components/FrameColorAdjustSliders";
import { RefinePanel } from "@/app/components/RefinePanel";
import { useCarouselWorkspace } from "@/context/carousel-workspace-context";
import { frameColorAdjustToCssFilter } from "@/lib/frame-color-adjust";

export default function RefinePage() {
  const router = useRouter();
  const {
    recommendation,
    slidePreviewBase64s,
    slidePreviewBase64sInstagram,
    loading,
    reRenderLoading,
    reRenderProgress,
    reRenderZip,
    socialCaption,
    setSocialCaption,
    zipBase64,
    editableSlides,
    frameColorAdjust,
    setFrameColorAdjust,
  } = useCarouselWorkspace();

  const [previewPlatform, setPreviewPlatform] =
    useState<CarouselPreviewPlatform>("youtube");
  const carouselSocialCaptionFieldId = useId();

  const youtubeSlides = slidePreviewBase64s ?? [];
  const instagramSlides = slidePreviewBase64sInstagram ?? [];

  const carouselColorPreviewFilter = useMemo(
    () => frameColorAdjustToCssFilter(frameColorAdjust),
    [frameColorAdjust]
  );
  const carouselBusy = loading || reRenderLoading;

  useEffect(() => {
    if (
      previewPlatform === "instagram" &&
      instagramSlides.length === 0 &&
      youtubeSlides.length > 0
    ) {
      setPreviewPlatform("youtube");
    }
  }, [
    previewPlatform,
    instagramSlides.length,
    youtubeSlides.length,
  ]);

  useEffect(() => {
    if (!recommendation) {
      router.replace("/");
    }
  }, [recommendation, router]);

  if (!recommendation) {
    return (
      <main className="min-h-[40vh] px-4 py-16 text-center">
        <p className="text-stone-600">Redirecting…</p>
      </main>
    );
  }
  const previewImages =
    previewPlatform === "youtube" ? youtubeSlides : instagramSlides;
  const hasInstagramPreview = instagramSlides.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 pb-24">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ContentMultiplierHomeLink className="inline-flex items-center gap-2 text-sm font-medium text-palette-depth hover:text-stone-900" />
          <Link
            href="/settings"
            className="text-sm font-medium text-stone-600 hover:text-stone-900"
          >
            Settings
          </Link>
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-stone-900">
          Edit Carousel
        </h1>
      </div>

      <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
        <div
          className={`flex min-h-[min(420px,60vh)] flex-col rounded-2xl border p-6 shadow-md ${
            carouselBusy
              ? "border-palette-pale/40 bg-gradient-to-b from-palette-pale/30 via-palette-pale/15 to-slate-50/80 shadow-palette-pale/25"
              : "border-stone-200 bg-white shadow-stone-200/40"
          }`}
        >
          {carouselBusy ? (
            <div
              className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center"
              role="status"
              aria-live="polite"
            >
              <span className="sr-only">Updating carousel, please wait.</span>
              <div
                className="mb-5 h-14 w-14 rounded-full border-[3px] border-palette-pale/80 border-t-palette-depth animate-spin"
                aria-hidden
              />
              <p className="text-base font-medium text-stone-800">
                Updating Carousel
              </p>
              <p className="mt-2 max-w-xs text-sm text-stone-600">
                {reRenderProgress ??
                  "Your preview will refresh when it\u2019s ready."}
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-medium text-stone-900">Preview</h2>
                {(youtubeSlides.length > 0 || hasInstagramPreview) && (
                  <div
                    className="flex shrink-0 rounded-lg border border-stone-200 bg-stone-50 p-0.5 text-xs font-semibold shadow-sm"
                    role="group"
                    aria-label="Preview format"
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewPlatform("youtube")}
                      aria-pressed={previewPlatform === "youtube"}
                      className={`rounded-md px-2.5 py-1.5 transition ${
                        previewPlatform === "youtube"
                          ? "bg-white text-palette-depth shadow-sm"
                          : "text-stone-600 hover:text-stone-900"
                      }`}
                    >
                      YouTube
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewPlatform("instagram")}
                      disabled={!hasInstagramPreview}
                      aria-pressed={previewPlatform === "instagram"}
                      title={
                        hasInstagramPreview
                          ? "1080×1350 (4:5) carousel"
                          : "Instagram-size previews unavailable"
                      }
                      className={`rounded-md px-2.5 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        previewPlatform === "instagram"
                          ? "bg-white text-palette-depth shadow-sm"
                          : "text-stone-600 hover:text-stone-900"
                      }`}
                    >
                      Instagram
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-6">
                {previewImages.length > 0 ? (
                  <CarouselSlideViewer
                    slideBase64s={previewImages}
                    previewPlatform={previewPlatform}
                    colorPreviewFilter={carouselColorPreviewFilter}
                  />
                ) : (
                  <p className="text-sm text-stone-600">
                    No slide images loaded.
                  </p>
                )}
              </div>
              <div className="mt-6">
                <CollapsibleSection title="Frame color">
                  <FrameColorAdjustSliders
                    idPrefix="refine-carousel"
                    value={frameColorAdjust}
                    onChange={setFrameColorAdjust}
                    disabled={carouselBusy}
                  />
                  <button
                    type="button"
                    onClick={() => void reRenderZip()}
                    disabled={
                      carouselBusy ||
                      !zipBase64 ||
                      editableSlides.length === 0
                    }
                    className="mt-4 w-full rounded-xl border border-palette-teal bg-palette-pale/25 py-2.5 text-sm font-semibold text-stone-800 transition hover:bg-palette-pale/45 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {reRenderLoading
                      ? "Updating…"
                      : "Bake color into slide PNGs (ZIP)"}
                  </button>
                </CollapsibleSection>
              </div>
              {recommendation !== null ? (
                <div className="mt-6">
                  <CollapsibleSection title="Post caption" defaultOpen={false}>
                    <p className="text-left text-[11px] leading-snug text-stone-500">
                      AI draft for Instagram/Facebook (Know / Like / Trust).
                      Edit before publishing.
                    </p>
                    <label
                      htmlFor={carouselSocialCaptionFieldId}
                      className="sr-only"
                    >
                      Post caption
                    </label>
                    <textarea
                      id={carouselSocialCaptionFieldId}
                      value={socialCaption}
                      onChange={(e) => setSocialCaption(e.target.value)}
                      disabled={carouselBusy}
                      rows={8}
                      placeholder="Caption appears here after processing…"
                      className="mt-2 w-full resize-y rounded-xl border border-stone-200 bg-stone-50/80 px-3 py-2.5 text-sm leading-relaxed text-stone-900 placeholder:text-stone-400 focus:border-palette-teal focus:outline-none focus:ring-1 focus:ring-palette-teal disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </CollapsibleSection>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-md shadow-stone-200/40">
          <RefinePanel />
        </div>
      </div>
    </main>
  );
}
