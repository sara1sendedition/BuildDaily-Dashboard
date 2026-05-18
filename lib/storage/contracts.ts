/**
 * Storage abstraction for the BuildDaily suite.
 *
 * Design notes:
 *  - Concrete adapters live in this folder (bunny-adapter.ts now;
 *    supabase-adapter.ts could be added for migration / fallback).
 *  - Callers should never bake provider-specific assumptions into routes.
 *  - Browser-side uploads go DIRECTLY to the provider via signed URL — the
 *    hub mints the signed URL via createUploadToken(), but the bytes never
 *    flow through the hub.
 */

/**
 * Which kind of asset is being stored.
 *  - "video"     — Studio recordings, V2S backend outputs, stitched finals.
 *                  Goes to Bunny Stream (HLS playback, adaptive bitrate).
 *  - "broll"     — User's reusable b-roll clips. Bunny Stream.
 *  - "brand-doc" — Brand documents (PDFs, .txt notes). Bunny Storage.
 *  - "avatar"    — User profile images. Bunny Storage.
 *  - "thumbnail" — Static images uploaded by the user (visual references,
 *                  carousel reference profiles). Bunny Storage.
 */
export type StorageKind =
  | "video"
  | "broll"
  | "brand-doc"
  | "avatar"
  | "thumbnail";

/** Identifies which Bunny product backs a stored asset. */
export type StorageProvider = "bunny-stream" | "bunny-storage";

/** What the browser receives to upload directly to the storage provider. */
export interface UploadToken {
  provider: StorageProvider;
  /** Direct upload endpoint (PUT for Storage, TUS endpoint for Stream). */
  uploadUrl: string;
  /** Where the asset will live: video_id for Stream, object key for Storage. */
  storagePath: string;
  /** Headers the browser must send with the upload PUT/PATCH. */
  headers: Record<string, string>;
  /** When this token expires (ISO timestamp). */
  expiresAt: string;
  /** Once uploaded, where the asset can be played back / read. */
  playbackUrl: string;
}

export interface CreateUploadTokenArgs {
  kind: StorageKind;
  userId: string;
  /** Optional; sniffed for things like content-type. */
  contentType?: string;
  /** Optional; only used for non-video kinds where the original name matters. */
  filename?: string;
  /**
   * Optional; for video kinds, the human-readable title that appears in
   * Bunny Stream's library UI. Defaults to a generated string.
   */
  title?: string;
  /** Optional; relevant only when the caller wants a specific TTL. */
  expiresInSec?: number;
}

export interface StorageAdapter {
  /**
   * Mints a signed payload the browser can use to upload direct-to-provider.
   * Hub never touches the bytes.
   */
  createUploadToken(args: CreateUploadTokenArgs): Promise<UploadToken>;

  /**
   * For Stream: returns the HLS playlist URL.
   * For Storage: returns the public CDN URL.
   */
  getPlaybackUrl(args: {
    kind: StorageKind;
    storagePath: string;
  }): string;

  /**
   * Returns a time-limited signed URL for a private asset.
   * Currently we keep most buckets public-read, so this falls back to
   * getPlaybackUrl() for those — but the interface allows tightening later.
   */
  getSignedReadUrl(args: {
    kind: StorageKind;
    storagePath: string;
    expiresInSec?: number;
  }): Promise<string>;

  /** Deletes an asset from the provider. */
  delete(args: { kind: StorageKind; storagePath: string }): Promise<void>;
}
