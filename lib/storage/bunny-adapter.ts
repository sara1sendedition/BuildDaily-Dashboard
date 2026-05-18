import { createHash } from "node:crypto";
import type {
  CreateUploadTokenArgs,
  StorageAdapter,
  StorageKind,
  StorageProvider,
  UploadToken,
} from "@/lib/storage/contracts";

/**
 * Bunny.net storage adapter.
 *
 * Two products in play:
 *   - Bunny Stream  → video kinds (video, broll). HLS + adaptive bitrate.
 *   - Bunny Storage → file kinds (brand-doc, avatar, thumbnail). S3-style.
 *
 * Auth model:
 *   - Stream presigned uploads use AuthorizationSignature (SHA256 of
 *     library_id + api_key + expiration_unix + video_guid) + AuthorizationExpire
 *     headers. Spec: https://docs.bunny.net/reference/tus-resumable-uploads
 *   - Storage uses an AccessKey header on the PUT request.
 *
 * Env vars required:
 *   BUNNY_STREAM_LIBRARY_ID
 *   BUNNY_STREAM_API_KEY
 *   BUNNY_STREAM_PULL_ZONE_HOSTNAME    (e.g. vz-abc123.b-cdn.net)
 *   BUNNY_STORAGE_ZONE_NAME
 *   BUNNY_STORAGE_ACCESS_KEY
 *   BUNNY_STORAGE_HOSTNAME             (e.g. storage.bunnycdn.com, region-specific)
 *   BUNNY_STORAGE_PULL_ZONE_HOSTNAME   (e.g. cdn.builddaily.app or {zone}.b-cdn.net)
 *
 * Provision instructions: see the overnight progress doc.
 */

const STREAM_API_BASE = "https://video.bunnycdn.com";

function env(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(
      `[bunny] Missing required env var ${name}. Set it in Coolify env vars on the hub service.`,
    );
  }
  return v;
}

function isVideoKind(kind: StorageKind): boolean {
  return kind === "video" || kind === "broll";
}

function providerFor(kind: StorageKind): StorageProvider {
  return isVideoKind(kind) ? "bunny-stream" : "bunny-storage";
}

/** Build the per-user object key for Storage assets. */
function storageObjectKey(args: {
  kind: StorageKind;
  userId: string;
  filename?: string;
}): string {
  const safeName =
    (args.filename ?? `${crypto.randomUUID()}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const folder =
    args.kind === "brand-doc"
      ? "brand-docs"
      : args.kind === "avatar"
      ? "avatars"
      : "thumbnails";
  if (args.kind === "avatar") {
    return `${folder}/${args.userId}/avatar.${safeName.split(".").pop() ?? "jpg"}`;
  }
  return `${folder}/${args.userId}/${crypto.randomUUID()}-${safeName}`;
}

class BunnyAdapter implements StorageAdapter {
  async createUploadToken(args: CreateUploadTokenArgs): Promise<UploadToken> {
    if (isVideoKind(args.kind)) {
      return this.createStreamUploadToken(args);
    }
    return this.createStorageUploadToken(args);
  }

  private async createStreamUploadToken(
    args: CreateUploadTokenArgs,
  ): Promise<UploadToken> {
    const libraryId = env("BUNNY_STREAM_LIBRARY_ID");
    const apiKey = env("BUNNY_STREAM_API_KEY");
    const pullZone = env("BUNNY_STREAM_PULL_ZONE_HOSTNAME");

    // Step 1: create the video metadata in the library — Bunny returns a guid.
    const title = args.title ?? `${args.kind}-${new Date().toISOString()}`;
    const createRes = await fetch(
      `${STREAM_API_BASE}/library/${libraryId}/videos`,
      {
        method: "POST",
        headers: {
          AccessKey: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      },
    );
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      throw new Error(
        `[bunny:stream] create video failed (${createRes.status}): ${body}`,
      );
    }
    const created = (await createRes.json()) as { guid: string };
    const videoGuid = created.guid;

    // Step 2: build TUS presigned-upload headers.
    const expiresInSec = args.expiresInSec ?? 3600;
    const expirationUnix = Math.floor(Date.now() / 1000) + expiresInSec;
    const signature = createHash("sha256")
      .update(`${libraryId}${apiKey}${expirationUnix}${videoGuid}`)
      .digest("hex");

    return {
      provider: "bunny-stream",
      uploadUrl: "https://video.bunnycdn.com/tusupload",
      storagePath: videoGuid,
      headers: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expirationUnix),
        VideoId: videoGuid,
        LibraryId: libraryId,
      },
      expiresAt: new Date(expirationUnix * 1000).toISOString(),
      playbackUrl: `https://${pullZone}/${videoGuid}/playlist.m3u8`,
    };
  }

  private async createStorageUploadToken(
    args: CreateUploadTokenArgs,
  ): Promise<UploadToken> {
    const zoneName = env("BUNNY_STORAGE_ZONE_NAME");
    const accessKey = env("BUNNY_STORAGE_ACCESS_KEY");
    const storageHost = env("BUNNY_STORAGE_HOSTNAME");
    const cdnHost = env("BUNNY_STORAGE_PULL_ZONE_HOSTNAME");

    const objectKey = storageObjectKey({
      kind: args.kind,
      userId: args.userId,
      filename: args.filename,
    });

    // Bunny Storage uses a per-request AccessKey header, no signing.
    // The hub returns the signed payload to the browser, which PUTs directly.
    const uploadUrl = `https://${storageHost}/${zoneName}/${objectKey}`;
    const expiresInSec = args.expiresInSec ?? 3600;

    return {
      provider: "bunny-storage",
      uploadUrl,
      storagePath: objectKey,
      headers: {
        AccessKey: accessKey,
        ...(args.contentType ? { "Content-Type": args.contentType } : {}),
      },
      expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
      playbackUrl: `https://${cdnHost}/${objectKey}`,
    };
  }

  getPlaybackUrl(args: { kind: StorageKind; storagePath: string }): string {
    if (isVideoKind(args.kind)) {
      const pullZone = env("BUNNY_STREAM_PULL_ZONE_HOSTNAME");
      return `https://${pullZone}/${args.storagePath}/playlist.m3u8`;
    }
    const cdnHost = env("BUNNY_STORAGE_PULL_ZONE_HOSTNAME");
    return `https://${cdnHost}/${args.storagePath}`;
  }

  async getSignedReadUrl(args: {
    kind: StorageKind;
    storagePath: string;
  }): Promise<string> {
    // For now both Stream and Storage pull zones are public-read.
    // If we later add token authentication to a pull zone, we'd compute the
    // Bunny URL-signing token here. See:
    // https://docs.bunny.net/docs/cdn-token-authentication
    return this.getPlaybackUrl(args);
  }

  async delete(args: {
    kind: StorageKind;
    storagePath: string;
  }): Promise<void> {
    if (isVideoKind(args.kind)) {
      const libraryId = env("BUNNY_STREAM_LIBRARY_ID");
      const apiKey = env("BUNNY_STREAM_API_KEY");
      const res = await fetch(
        `${STREAM_API_BASE}/library/${libraryId}/videos/${args.storagePath}`,
        { method: "DELETE", headers: { AccessKey: apiKey } },
      );
      if (!res.ok && res.status !== 404) {
        throw new Error(`[bunny:stream] delete failed (${res.status})`);
      }
      return;
    }
    const zoneName = env("BUNNY_STORAGE_ZONE_NAME");
    const accessKey = env("BUNNY_STORAGE_ACCESS_KEY");
    const storageHost = env("BUNNY_STORAGE_HOSTNAME");
    const res = await fetch(
      `https://${storageHost}/${zoneName}/${args.storagePath}`,
      { method: "DELETE", headers: { AccessKey: accessKey } },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`[bunny:storage] delete failed (${res.status})`);
    }
  }
}

/** Default exported storage adapter. Swap for a mock in tests. */
export const storage: StorageAdapter = new BunnyAdapter();
