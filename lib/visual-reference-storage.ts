/** Persist visual reference uploads + profiles in localStorage (browser only). */

import type {
  StoredVisualReference,
  VisualReferenceKind,
} from "@/lib/visual-reference-types";

const KEY = (kind: VisualReferenceKind) => `v2c-visual-ref-${kind}-v1`;

export function getStoredVisualReference(
  kind: VisualReferenceKind
): StoredVisualReference | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY(kind));
    if (!raw) return null;
    const o = JSON.parse(raw) as StoredVisualReference;
    if (o?.schemaVersion !== 1 || !o.profile || o.kind !== kind) return null;
    if (typeof o.profile.manualExtendedMarkdown !== "string") {
      o.profile.manualExtendedMarkdown = "";
    }
    return o;
  } catch {
    return null;
  }
}

export function setStoredVisualReference(entry: StoredVisualReference): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY(entry.kind), JSON.stringify(entry));
  } catch {
    try {
      const lean: StoredVisualReference = {
        ...entry,
        thumbnailDataUrl: null,
      };
      localStorage.setItem(KEY(entry.kind), JSON.stringify(lean));
    } catch {
      // quota / private mode
    }
  }
}

export function clearStoredVisualReference(kind: VisualReferenceKind): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY(kind));
  } catch {
    // ignore
  }
}

export function getAllStoredVisualReferences(): Record<
  VisualReferenceKind,
  StoredVisualReference | null
> {
  return {
    carousel: getStoredVisualReference("carousel"),
    photo: getStoredVisualReference("photo"),
    image: getStoredVisualReference("image"),
  };
}

/** JSON of `profile` for multipart `visualReference*` fields (browser only). */
export function getVisualReferenceProfileJsonForApi(
  kind: VisualReferenceKind
): string {
  if (typeof window === "undefined") return "";
  const s = getStoredVisualReference(kind);
  if (!s?.profile) return "";
  try {
    return JSON.stringify(s.profile);
  } catch {
    return "";
  }
}

/** Append saved visual references when present (carousel / photo / image). */
export function appendVisualReferenceFormFields(fd: FormData): void {
  if (typeof window === "undefined") return;
  const carousel = getVisualReferenceProfileJsonForApi("carousel");
  const photo = getVisualReferenceProfileJsonForApi("photo");
  const image = getVisualReferenceProfileJsonForApi("image");
  if (carousel) fd.append("visualReferenceCarousel", carousel);
  if (photo) fd.append("visualReferencePhoto", photo);
  if (image) fd.append("visualReferenceImage", image);
}
