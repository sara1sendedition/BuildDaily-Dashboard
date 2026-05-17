"use client";

import Link from "next/link";
import { ContentMultiplierHomeLink } from "@/app/components/ContentMultiplierMark";
import { useCallback, useId, useMemo, useState } from "react";
import {
  CarouselSlideViewer,
  type CarouselPreviewPlatform,
} from "@/app/components/CarouselSlideViewer";
import {
  CAROUSEL_LABELS,
  POST_STYLE_TYPE_ORDER,
  type ApiRecommendation,
} from "@/context/carousel-workspace-context";
import { clientApiPath } from "@/lib/client-api-path";
import {
  getCarouselFocusFromStorage,
  MAX_CAROUSEL_FOCUS_CHARS,
} from "@/lib/carousel-focus";
import {
  getCopyContextFromStorage,
  MAX_COPY_CONTEXT_CHARS,
} from "@/lib/copy-context";
import {
  getLearnedFromEditsBlob,
  mergeCopyContextWithLearnings,
} from "@/lib/learned-from-edits";
import { appendVisualReferenceFormFields } from "@/lib/visual-reference-storage";
import {
  getDefaultCaptionCtaFromStorage,
  MAX_DEFAULT_CAPTION_CTA_CHARS,
} from "@/lib/default-caption-cta";
import type { CarouselType } from "@/lib/types";

async function extractCarouselSlidePreviewsFromZipSafe(zipBase64: string) {
  const { extractCarouselSlidePreviewsFromZip } = await import(
    "@/lib/zip-slide-previews"
  );
  return extractCarouselSlidePreviewsFromZip(zipBase64);
}

export default function StyleCarouselPage() {
  const styleInputId = useId();
  const videoInputId = useId();
  const [styleFile, setStyleFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [carouselOverride, setCarouselOverride] = useState<CarouselType | "">(
    ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<ApiRecommendation | null>(
    null
  );
  const [zipBase64, setZipBase64] = useState<string | null>(null);
  const [youtubeSlides, setYoutubeSlides] = useState<string[]>([]);
  const [instagramSlides, setInstagramSlides] = useState<string[]>([]);
  const [socialCaption, setSocialCaption] = useState("");
  const [previewPlatform, setPreviewPlatform] =
    useState<CarouselPreviewPlatform>("youtube");

  const slidesForViewer = useMemo(
    () => (previewPlatform === "instagram" ? instagramSlides : youtubeSlides),
    [previewPlatform, instagramSlides, youtubeSlides]
  );

  const process = useCallback(async () => {
    setError(null);
    setRecommendation(null);
    setZipBase64(null);
    setYoutubeSlides([]);
    setInstagramSlides([]);
    setSocialCaption("");
    if (!videoFile || !styleFile) {
      setError("Choose both a style reference image and a video.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("video", videoFile);
      fd.append("styleImage", styleFile);
      fd.append("layoutId", "stacked_center");
      fd.append("brandingId", "default");
      if (carouselOverride) fd.append("carouselType", carouselOverride);

      const copyCtx = getCopyContextFromStorage().trim();
      const learned = getLearnedFromEditsBlob().trim();
      const mergedCopy = mergeCopyContextWithLearnings(
        copyCtx || undefined,
        learned || undefined
      );
      if (mergedCopy) {
        fd.append("copyContext", mergedCopy.slice(0, MAX_COPY_CONTEXT_CHARS));
      }
      const carouselFocus = getCarouselFocusFromStorage().trim();
      if (carouselFocus) {
        fd.append(
          "carouselFocus",
          carouselFocus.slice(0, MAX_CAROUSEL_FOCUS_CHARS)
        );
      }
      const defaultCaptionCta = getDefaultCaptionCtaFromStorage().trim();
      if (defaultCaptionCta) {
        fd.append(
          "defaultCaptionCta",
          defaultCaptionCta.slice(0, MAX_DEFAULT_CAPTION_CTA_CHARS)
        );
      }
      appendVisualReferenceFormFields(fd);

      const res = await fetch(clientApiPath("/api/style-carousel/process"), {
        method: "POST",
        body: fd,
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        throw new Error(
          res.ok ? "Invalid response from server." : `Request failed (${res.status}).`
        );
      }
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Request failed"
        );
      }
      if (typeof data.recommendation !== "object" || data.recommendation === null) {
        throw new Error("Incomplete response from server.");
      }
      setRecommendation(data.recommendation as ApiRecommendation);
      setSocialCaption(
        typeof data.socialCaption === "string" ? data.socialCaption : ""
      );
      const z = typeof data.zipBase64 === "string" ? data.zipBase64 : null;
      setZipBase64(z);
      const first =
        typeof data.firstSlidePreviewBase64 === "string"
          ? data.firstSlidePreviewBase64
          : null;
      if (z) {
        try {
          const { youtube, instagram } =
            await extractCarouselSlidePreviewsFromZipSafe(z);
          setYoutubeSlides(
            youtube.length > 0 ? youtube : first ? [first] : []
          );
          setInstagramSlides(instagram.length > 0 ? instagram : []);
        } catch {
          setYoutubeSlides(first ? [first] : []);
          setInstagramSlides([]);
        }
      } else {
        setYoutubeSlides(first ? [first] : []);
        setInstagramSlides([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Processing failed");
    } finally {
      setBusy(false);
    }
  }, [videoFile, styleFile, carouselOverride]);

  const downloadZip = useCallback(() => {
    if (!zipBase64 || !videoFile) return;
    const base = videoFile.name.replace(/\.[^/.]+$/i, "").trim() || "video";
    const a = document.createElement("a");
    a.href = `data:application/zip;base64,${zipBase64}`;
    a.download = `${base}_style_carousel.zip`;
    a.click();
  }, [zipBase64, videoFile]);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Style-match carousel
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              Upload a graphic with your text overlay, then a video. Vision infers
              carousel primary (headline) and secondary (body / supporting line)
              colors when they differ, plus **where the text block sits** (left /
              center / right and vertical band), outline, shadow, letter-spacing,
              and Poppins weights. Layout is not the fixed studio presets— it
              follows the reference image.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <ContentMultiplierHomeLink className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100" />
            <Link
              href="/settings/visual-references"
              className="rounded-lg border border-stone-200 bg-white px-3 py-2 font-medium text-stone-800 hover:bg-stone-50"
            >
              Visual references
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-8">
        <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <div>
            <label
              htmlFor={styleInputId}
              className="block text-sm font-medium text-stone-800"
            >
              Reference image (with text overlay)
            </label>
            <input
              id={styleInputId}
              type="file"
              accept="image/*"
              className="mt-2 block w-full text-sm text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
              onChange={(e) =>
                setStyleFile(e.target.files?.[0] ?? null)
              }
            />
          </div>
          <div>
            <label
              htmlFor={videoInputId}
              className="block text-sm font-medium text-stone-800"
            >
              Video (same as main carousel tool)
            </label>
            <input
              id={videoInputId}
              type="file"
              accept="video/*"
              className="mt-2 block w-full text-sm text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
              onChange={(e) =>
                setVideoFile(e.target.files?.[0] ?? null)
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-800">
              Format override (optional)
            </label>
            <select
              value={carouselOverride}
              onChange={(e) =>
                setCarouselOverride(
                  (e.target.value || "") as CarouselType | ""
                )
              }
              className="mt-2 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">Auto (AI picks)</option>
              {POST_STYLE_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {CAROUSEL_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void process()}
            className="w-full rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {busy ? "Processing…" : "Generate carousel"}
          </button>
          {error ? (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        {recommendation ? (
          <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Result</h2>
            <p className="text-sm text-stone-600">
              <span className="font-medium text-stone-800">Suggested format:</span>{" "}
              {CAROUSEL_LABELS[recommendation.recommendedType]}{" "}
              <span className="text-stone-400">
                ({recommendation.confidence} confidence)
              </span>
            </p>
            {recommendation.rationale ? (
              <p className="text-sm text-stone-600">{recommendation.rationale}</p>
            ) : null}

            {slidesForViewer.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
                    Preview
                  </span>
                  {instagramSlides.length > 0 ? (
                    <div className="flex rounded-lg border border-stone-200 p-0.5 text-xs">
                      <button
                        type="button"
                        className={`rounded-md px-2 py-1 ${
                          previewPlatform === "youtube"
                            ? "bg-stone-900 text-white"
                            : "text-stone-600"
                        }`}
                        onClick={() => setPreviewPlatform("youtube")}
                      >
                        1:1
                      </button>
                      <button
                        type="button"
                        className={`rounded-md px-2 py-1 ${
                          previewPlatform === "instagram"
                            ? "bg-stone-900 text-white"
                            : "text-stone-600"
                        }`}
                        onClick={() => setPreviewPlatform("instagram")}
                      >
                        4:5
                      </button>
                    </div>
                  ) : null}
                </div>
                <CarouselSlideViewer slideBase64s={slidesForViewer} />
              </div>
            ) : null}

            {socialCaption ? (
              <details className="rounded-lg border border-stone-100 bg-stone-50/80 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-stone-800">
                  Social caption
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-stone-700">
                  {socialCaption}
                </p>
              </details>
            ) : null}

            {zipBase64 ? (
              <button
                type="button"
                onClick={downloadZip}
                className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-900 hover:bg-stone-50"
              >
                Download ZIP
              </button>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
