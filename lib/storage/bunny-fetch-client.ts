"use client";

import type { BunnyAssetUrls } from "@/lib/storage/bunny-upload-client";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Fetch a public Bunny CDN image URL and return raw base64 (no data: prefix). */
export async function fetchUrlToBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[bunny-fetch] ${res.status} for ${url}`);
      return null;
    }
    return arrayBufferToBase64(await res.arrayBuffer());
  } catch (e) {
    console.warn(`[bunny-fetch] network error for ${url}:`, e);
    return null;
  }
}

export async function fetchUrlsToBase64(
  urls: string[],
): Promise<(string | null)[]> {
  return Promise.all(urls.map((url) => fetchUrlToBase64(url)));
}

function nonEmptyUrls(urls: string[] | undefined): string[] {
  return (urls ?? []).filter((u) => typeof u === "string" && u.trim().length > 0);
}

export type PreviewRehydrateInput = {
  bunnyUrls?: BunnyAssetUrls;
  slidePreviewBase64s?: string[] | null;
  slidePreviewBase64sInstagram?: string[] | null;
  firstSlidePreviewBase64?: string | null;
  imagePost?: {
    hook: string;
    microCta: string;
    caption: string;
    altText: string;
    evidenceSegmentIds: number[];
    transcript: {
      id: number;
      text: string;
      startSec: number;
      endSec: number;
    }[];
    durationSec: number;
    frameTimeSec: number;
    imageBase64: string;
  } | null;
  socialCaption?: string;
  transcript?: {
    id: number;
    text: string;
    startSec: number;
    endSec: number;
  }[];
  durationSec?: number | null;
};

export type PreviewRehydratePatch = Pick<
  PreviewRehydrateInput,
  | "slidePreviewBase64s"
  | "slidePreviewBase64sInstagram"
  | "firstSlidePreviewBase64"
  | "imagePost"
>;

/**
 * After Hub hydration, snapshots keep Bunny URLs but drop in-memory base64.
 * Pull slide PNGs + image-post JPEG back into the snapshot for UI previews.
 */
export async function buildPreviewRehydratePatchFromBunny(
  snap: PreviewRehydrateInput,
): Promise<PreviewRehydratePatch | null> {
  const bunnyUrls = snap.bunnyUrls;
  if (!bunnyUrls) return null;

  const needsSlides = !(snap.slidePreviewBase64s?.length ?? 0);
  const needsSlidesIg = !(snap.slidePreviewBase64sInstagram?.length ?? 0);
  const needsImagePost =
    !(snap.imagePost?.imageBase64?.length ?? 0) &&
    Boolean(bunnyUrls.imagePostUrl?.trim());

  const slideUrlList = nonEmptyUrls(bunnyUrls.slideUrls);
  const slideIgUrlList = nonEmptyUrls(bunnyUrls.slideUrlsInstagram);

  if (
    !(needsSlides && slideUrlList.length > 0) &&
    !(needsSlidesIg && slideIgUrlList.length > 0) &&
    !needsImagePost
  ) {
    return null;
  }

  const [slidesRaw, slidesIgRaw, imagePostB64] = await Promise.all([
    needsSlides && slideUrlList.length > 0
      ? fetchUrlsToBase64(slideUrlList)
      : Promise.resolve(null),
    needsSlidesIg && slideIgUrlList.length > 0
      ? fetchUrlsToBase64(slideIgUrlList)
      : Promise.resolve(null),
    needsImagePost && bunnyUrls.imagePostUrl
      ? fetchUrlToBase64(bunnyUrls.imagePostUrl)
      : Promise.resolve(null),
  ]);

  const patch: PreviewRehydratePatch = {};

  if (slidesRaw) {
    const slides = slidesRaw.filter((s): s is string => !!s);
    if (slides.length > 0) {
      patch.slidePreviewBase64s = slides;
      patch.firstSlidePreviewBase64 = slides[0] ?? null;
    }
  }

  if (slidesIgRaw) {
    const slidesIg = slidesIgRaw.filter((s): s is string => !!s);
    if (slidesIg.length > 0) {
      patch.slidePreviewBase64sInstagram = slidesIg;
    }
  }

  if (imagePostB64) {
    const existing = snap.imagePost;
    patch.imagePost = {
      hook: existing?.hook?.trim() ?? "",
      microCta: existing?.microCta?.trim() ?? "",
      caption:
        existing?.caption?.trim() ??
        snap.socialCaption?.trim() ??
        "",
      altText: existing?.altText?.trim() ?? "",
      evidenceSegmentIds: existing?.evidenceSegmentIds ?? [],
      transcript: existing?.transcript ?? snap.transcript ?? [],
      durationSec: existing?.durationSec ?? snap.durationSec ?? 0,
      frameTimeSec: existing?.frameTimeSec ?? 0,
      imageBase64: imagePostB64,
    };
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/** Drop patch fields the snapshot already has (avoids clobber after a race). */
export function filterPreviewRehydratePatch(
  latest: PreviewRehydrateInput,
  patch: PreviewRehydratePatch,
): PreviewRehydratePatch | null {
  const filtered: PreviewRehydratePatch = {};
  if (
    !(latest.slidePreviewBase64s?.length ?? 0) &&
    patch.slidePreviewBase64s?.length
  ) {
    filtered.slidePreviewBase64s = patch.slidePreviewBase64s;
    filtered.firstSlidePreviewBase64 = patch.firstSlidePreviewBase64 ?? null;
  }
  if (
    !(latest.slidePreviewBase64sInstagram?.length ?? 0) &&
    patch.slidePreviewBase64sInstagram?.length
  ) {
    filtered.slidePreviewBase64sInstagram = patch.slidePreviewBase64sInstagram;
  }
  if (
    !(latest.imagePost?.imageBase64?.length ?? 0) &&
    patch.imagePost?.imageBase64?.length
  ) {
    const prev = latest.imagePost;
    const next = patch.imagePost;
    filtered.imagePost = {
      hook: prev?.hook?.trim() || next.hook?.trim() || "",
      microCta: prev?.microCta?.trim() || next.microCta?.trim() || "",
      caption:
        prev?.caption?.trim() ||
        next.caption?.trim() ||
        latest.socialCaption?.trim() ||
        "",
      altText: prev?.altText?.trim() || next.altText?.trim() || "",
      evidenceSegmentIds:
        prev?.evidenceSegmentIds?.length
          ? prev.evidenceSegmentIds
          : (next.evidenceSegmentIds ?? []),
      transcript: prev?.transcript?.length
        ? prev.transcript
        : (next.transcript?.length
            ? next.transcript
            : (latest.transcript ?? [])),
      durationSec:
        typeof prev?.durationSec === "number" && prev.durationSec > 0
          ? prev.durationSec
          : typeof next.durationSec === "number" && next.durationSec > 0
            ? next.durationSec
            : (latest.durationSec ?? 0),
      frameTimeSec:
        typeof prev?.frameTimeSec === "number" && prev.frameTimeSec > 0
          ? prev.frameTimeSec
          : typeof next.frameTimeSec === "number" && next.frameTimeSec > 0
            ? next.frameTimeSec
            : 0,
      imageBase64: next.imageBase64,
    };
  }
  return Object.keys(filtered).length > 0 ? filtered : null;
}

export function snapshotNeedsPreviewRehydrate(
  snap: PreviewRehydrateInput | undefined,
): boolean {
  if (!snap?.bunnyUrls) return false;
  const urls: BunnyAssetUrls = snap.bunnyUrls;
  const needsSlides =
    !(snap.slidePreviewBase64s?.length ?? 0) &&
    nonEmptyUrls(urls.slideUrls).length > 0;
  const needsSlidesIg =
    !(snap.slidePreviewBase64sInstagram?.length ?? 0) &&
    nonEmptyUrls(urls.slideUrlsInstagram).length > 0;
  const needsImagePost =
    !(snap.imagePost?.imageBase64?.length ?? 0) &&
    Boolean(urls.imagePostUrl?.trim());
  return needsSlides || needsSlidesIg || needsImagePost;
}
