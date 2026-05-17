import type { QueueCarouselSnapshot } from "@/context/carousel-workspace-context";

function pickSlidesForMetaFromArrays(
  youtubeSlides: string[],
  instagramSlides: string[],
  postToInstagram: boolean,
  postToFacebook: boolean
): string[] {
  const igOk = instagramSlides.length > 0 ? instagramSlides : null;
  const ytOk = youtubeSlides.length > 0 ? youtubeSlides : null;
  if (postToInstagram && postToFacebook) {
    return igOk ?? ytOk ?? [];
  }
  if (postToInstagram) return instagramSlides;
  return igOk ?? ytOk ?? [];
}

/** Cached slide PNGs from the workspace (may be only `firstSlidePreview` if ZIP parse failed). */
export function slidesForMetaFromSnapshot(
  snap: QueueCarouselSnapshot,
  postToInstagram: boolean,
  postToFacebook: boolean
): string[] {
  return pickSlidesForMetaFromArrays(
    snap.slidePreviewBase64s ?? [],
    snap.slidePreviewBase64sInstagram ?? [],
    postToInstagram,
    postToFacebook
  );
}

/**
 * Slides to upload to Meta: prefer fresh extraction from `zipBase64` (full-resolution
 * `youtube_1x1` / `instagram_4x5` PNGs) so publish is not limited to in-memory previews.
 */
export async function slidesForMetaFromZipOrSnapshot(
  snap: QueueCarouselSnapshot,
  postToInstagram: boolean,
  postToFacebook: boolean
): Promise<string[]> {
  const z = snap.zipBase64;
  if (typeof z === "string" && z.length > 0) {
    try {
      const { extractCarouselSlidePreviewsFromZip } = await import(
        "@/lib/zip-slide-previews"
      );
      const { youtube, instagram } =
        await extractCarouselSlidePreviewsFromZip(z);
      const fromZip = pickSlidesForMetaFromArrays(
        youtube,
        instagram,
        postToInstagram,
        postToFacebook
      );
      if (fromZip.length > 0) return fromZip;
    } catch {
      /* fall through to cached previews */
    }
  }
  return slidesForMetaFromSnapshot(snap, postToInstagram, postToFacebook);
}

export function captionFromSnapshot(snap: QueueCarouselSnapshot): string {
  const cap = snap.socialCaption?.trim() ?? "";
  if (cap.length > 0) return cap;
  return snap.editableSlides
    .map((s) => s.headline.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function captionFromImagePostSnapshot(
  snap: QueueCarouselSnapshot
): string {
  return snap.imagePost?.caption?.trim() ?? "";
}

/** Single image for Meta when scheduling the still (4:5) instead of the carousel. */
export function imagePostSlideForMeta(snap: QueueCarouselSnapshot): string[] {
  const b64 = snap.imagePost?.imageBase64;
  return typeof b64 === "string" && b64.length > 0 ? [b64] : [];
}
