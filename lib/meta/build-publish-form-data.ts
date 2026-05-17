/** Decode one slide PNG from raw base64 or data-URL (browser). */
export function slideBase64ToBlob(s: string, slideIndexForError: number): Blob {
  const trimmed = s.trim();
  const b64 = /^data:image\/\w+;base64,(.+)$/i.exec(trimmed)?.[1] ?? trimmed;
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new Error(`Slide ${slideIndexForError} is not valid base64.`);
  }
  const u8 = new Uint8Array(binary.length);
  const chunk = 8192;
  for (let j = 0; j < binary.length; j += chunk) {
    const end = Math.min(j + chunk, binary.length);
    for (let k = j; k < end; k++) {
      u8[k] = binary.charCodeAt(k);
    }
  }
  return new Blob([u8], { type: "image/png" });
}

/**
 * Build multipart body for POST /api/integrations/meta/publish (binary PNGs, no base64 inflation).
 */
export function buildMetaPublishFormData(params: {
  caption: string;
  publishInstagram: boolean;
  publishFacebook: boolean;
  scheduledPublishTime?: number;
  /** Raw base64 or data-URL PNG strings (decoded to binary in the browser). */
  slidesBase64: string[];
}): FormData {
  const fd = new FormData();
  fd.append("caption", params.caption);
  fd.append("publishInstagram", params.publishInstagram ? "1" : "0");
  fd.append("publishFacebook", params.publishFacebook ? "1" : "0");
  if (
    params.scheduledPublishTime != null &&
    Number.isFinite(params.scheduledPublishTime) &&
    params.scheduledPublishTime > 0
  ) {
    fd.append("scheduledPublishTime", String(params.scheduledPublishTime));
  }
  for (let i = 0; i < params.slidesBase64.length; i++) {
    fd.append(
      "slide",
      slideBase64ToBlob(params.slidesBase64[i]!, i + 1),
      `slide_${String(i + 1).padStart(2, "0")}.png`
    );
  }
  return fd;
}
