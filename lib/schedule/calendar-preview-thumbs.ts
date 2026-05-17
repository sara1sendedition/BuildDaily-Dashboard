import type { QueueCarouselSnapshot } from "@/context/carousel-workspace-context";

export type ScheduleContentKind = "carousel" | "photo" | "short";

const MAX_HOOK_CHARS = 140;

/** First slide headline (carousel hook). */
export function carouselHookFromSnapshot(
  snap: QueueCarouselSnapshot | null
): string {
  const h = snap?.editableSlides?.[0]?.headline?.trim();
  if (!h) return "";
  return h.length > MAX_HOOK_CHARS ? `${h.slice(0, MAX_HOOK_CHARS)}…` : h;
}

/** Image-post overlay hook. */
export function photoHookFromSnapshot(snap: QueueCarouselSnapshot | null): string {
  const h = snap?.imagePost?.hook?.trim();
  if (!h) return "";
  return h.length > MAX_HOOK_CHARS ? `${h.slice(0, MAX_HOOK_CHARS)}…` : h;
}

export function displayHookForSchedule(
  kind: ScheduleContentKind,
  snap: QueueCarouselSnapshot | null,
  videoFileName: string
): string {
  const fromSnap =
    kind === "photo"
      ? photoHookFromSnapshot(snap)
      : kind === "short"
        ? carouselHookFromSnapshot(snap) ||
          photoHookFromSnapshot(snap)
        : carouselHookFromSnapshot(snap);
  if (fromSnap) return fromSnap;
  const stem = videoFileName.replace(/\.[^/.]+$/, "").trim();
  return stem || videoFileName;
}

/** Ordered slide PNGs (raw base64, no data-URL prefix) for calendar thumbnails. */
export function pickSlidePreviewPngsForCalendar(
  snap: QueueCarouselSnapshot | null,
  postToInstagram: boolean,
  postToFacebook: boolean
): string[] {
  if (!snap) return [];
  const ig = (snap.slidePreviewBase64sInstagram ?? []).filter(
    (s): s is string => typeof s === "string" && s.length > 0
  );
  const yt = (snap.slidePreviewBase64s ?? []).filter(
    (s): s is string => typeof s === "string" && s.length > 0
  );
  if (postToInstagram && !postToFacebook && ig.length > 0) return ig;
  if (postToFacebook && !postToInstagram && yt.length > 0) return yt;
  if (ig.length > 0) return ig;
  if (yt.length > 0) return yt;
  const first = snap.firstSlidePreviewBase64;
  return first ? [first] : [];
}

/** Single 4:5 still for calendar when scheduling the image post. */
export function pickPhotoPreviewPngsForCalendar(
  snap: QueueCarouselSnapshot | null
): string[] {
  const b64 = snap?.imagePost?.imageBase64;
  return typeof b64 === "string" && b64.length > 0 ? [b64] : [];
}

export function slideCountForCalendar(
  snap: QueueCarouselSnapshot | null,
  previewPngs: string[]
): number {
  if (previewPngs.length > 0) return previewPngs.length;
  const n = snap?.editableSlides?.length;
  if (typeof n === "number" && n > 0) return n;
  return 0;
}

/** Resize PNG base64 to a small JPEG data URL for localStorage-friendly calendar tiles. */
export function downscalePngBase64ToJpegDataUrl(
  pngBase64Raw: string,
  maxEdgePx: number,
  quality: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w < 1 || h < 1) {
        reject(new Error("invalid image dimensions"));
        return;
      }
      const scale = Math.min(1, maxEdgePx / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0, cw, ch);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = `data:image/png;base64,${pngBase64Raw}`;
  });
}
