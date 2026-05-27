"use client";

import { clientApiPath } from "@/lib/client-api-path";

/**
 * Browser-side helpers for uploading carousel slides + image-post JPEGs to
 * Bunny.net via the Hub's presigned upload-token flow.
 *
 * Phase 2.0 scope: Bunny **Storage** only (simple PUT with AccessKey header).
 * Bunny Stream / TUS for source videos + reel MP4s comes in Phase 2.1.
 */

/** Asset URLs persisted alongside a queue snapshot once Bunny upload completes. */
export type BunnyAssetUrls = {
  /** Square / Facebook-shaped slides (whatever the carousel ZIP contains). */
  slideUrls?: string[];
  /** 1080×1350 (4:5) Instagram-shaped slides; absent when ZIP has no instagram folder. */
  slideUrlsInstagram?: string[];
  /** Single 4:5 image-post URL. */
  imagePostUrl?: string;
  /** Phase 2.1 — Reel MP4 (raw video file on Bunny Storage). */
  reelMp4Url?: string;
  /**
   * Phase 3.B — Original source video uploaded by the user (raw MP4 on
   * Bunny Storage, NOT Stream). Lets the home page rehydrate a re-editable
   * File after browser restart / device switch.
   */
  sourceVideoUrl?: string;
};

/** Wire shape returned by the Hub's `/api/v1/storage/upload-token`. */
export type UploadToken = {
  provider: "bunny-stream" | "bunny-storage";
  uploadUrl: string;
  storagePath: string;
  headers: Record<string, string>;
  expiresAt: string;
  playbackUrl: string;
};

async function mintToken(opts: {
  kind: "thumbnail";
  filename: string;
  contentType: string;
}): Promise<UploadToken | null> {
  let res: Response;
  try {
    res = await fetch(clientApiPath("/api/hub/storage/upload-token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: opts.kind,
        filename: opts.filename,
        contentType: opts.contentType,
      }),
    });
  } catch (e) {
    console.warn("[bunny-upload] mint token network error:", e);
    return null;
  }
  if (!res.ok) {
    console.warn("[bunny-upload] mint token failed:", res.status, await res.text());
    return null;
  }
  try {
    const j = (await res.json()) as { data?: UploadToken };
    return j.data ?? null;
  } catch {
    return null;
  }
}

/** Convert a base64 / data-URL PNG or JPEG string to an ArrayBuffer body. */
function base64ToArrayBuffer(s: string): {
  buffer: ArrayBuffer;
  contentType: string;
} {
  const trimmed = s.trim();
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(trimmed);
  const contentType = m ? m[1]! : "image/png";
  const b64 = m ? m[2]! : trimmed;
  const bin = atob(b64);
  const buffer = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return { buffer, contentType };
}

/**
 * Upload a single base64 PNG/JPEG to Bunny Storage. Returns the public
 * playbackUrl on success or `null` if anything fails (caller treats Bunny
 * upload as best-effort; existing base64 path stays as a fallback).
 */
export async function uploadImageToBunnyStorage(
  base64: string,
  hint: { filename: string },
): Promise<string | null> {
  const { buffer, contentType } = base64ToArrayBuffer(base64);
  const token = await mintToken({
    kind: "thumbnail",
    filename: hint.filename,
    contentType,
  });
  if (!token) return null;
  // Bunny Storage uses a PUT with the AccessKey header (no signing required).
  // Wrap in a Blob so TS's strict BodyInit check is happy across browser +
  // Node 22 fetch implementations.
  const body = new Blob([buffer], { type: contentType });
  let res: Response;
  try {
    res = await fetch(token.uploadUrl, {
      method: "PUT",
      headers: { ...token.headers, "Content-Type": contentType },
      body,
    });
  } catch (e) {
    console.warn("[bunny-upload] PUT network error:", e);
    return null;
  }
  if (!res.ok) {
    console.warn(
      "[bunny-upload] PUT failed:",
      res.status,
      await res.text().catch(() => ""),
    );
    return null;
  }
  return token.playbackUrl;
}

/**
 * Phase 2.1 — Upload a binary File (reel MP4, source video) to Bunny Storage
 * as a raw file. Returns the public CDN playbackUrl on success, `null` on
 * failure. Uses Bunny **Storage** (PUT + AccessKey), not Stream/TUS, so it's
 * a simple round-trip — fine for reel-sized MP4s up to ~200MB.
 */
export async function uploadFileToBunnyStorage(
  file: File | Blob,
  hint: { filename: string; contentType?: string },
): Promise<string | null> {
  const detectedType = file instanceof File ? file.type : "";
  const contentType =
    hint.contentType ?? (detectedType.length > 0 ? detectedType : "video/mp4");
  const token = await mintToken({
    kind: "thumbnail",
    filename: hint.filename,
    contentType,
  });
  if (!token) return null;
  let res: Response;
  try {
    res = await fetch(token.uploadUrl, {
      method: "PUT",
      headers: { ...token.headers, "Content-Type": contentType },
      body: file,
    });
  } catch (e) {
    console.warn("[bunny-upload] PUT (file) network error:", e);
    return null;
  }
  if (!res.ok) {
    console.warn(
      "[bunny-upload] PUT (file) failed:",
      res.status,
      await res.text().catch(() => ""),
    );
    return null;
  }
  return token.playbackUrl;
}

/** Upload multiple slides in parallel; returns same-length array, `null` for any failure. */
export async function uploadSlidesToBunnyStorage(
  slides: string[],
  hint: { prefix: string },
): Promise<(string | null)[]> {
  return Promise.all(
    slides.map((slide, i) =>
      uploadImageToBunnyStorage(slide, {
        filename: `${hint.prefix}-${String(i + 1).padStart(2, "0")}.png`,
      }),
    ),
  );
}
