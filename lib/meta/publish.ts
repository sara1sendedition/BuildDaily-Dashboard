import {
  assertOk,
  MetaGraphError,
  readGraphJsonBody,
  type MetaGraphErrorBody,
} from "./errors";
import { assertInstagramFuturePublishSupported } from "./instagram-native-schedule";
import { pngBufferToJpegBuffer } from "./png-to-jpeg";

/** Lossy JPEG for Meta Page photo upload: smaller than PNG, still strong on-phone quality. */
const META_PUBLISH_JPEG_QUALITY = 0.89;

function graphBase(version: string): string {
  return `https://graph.facebook.com/${version}`;
}

/**
 * Scheduled Page feed posts need `published=false` + `scheduled_publish_time`.
 * If the time is too soon, Meta often returns a generic "(#3) User must be on whitelist"
 * instead of a clear date error. Token must be a **Page** access token with
 * `pages_manage_posts` (Advanced access if publishing outside app testers).
 */
function assertFacebookScheduledTimeNotTooSoon(unixSec: number): void {
  const now = Math.floor(Date.now() / 1000);
  const minLead = 600; // 10 minutes — common Meta minimum for scheduled Page posts
  if (unixSec < now + minLead) {
    throw new MetaGraphError({
      error: {
        message: `Facebook scheduled time must be at least ~10 minutes in the future (Meta). Got ${new Date(unixSec * 1000).toISOString()}. If Meta still returns a whitelist error with a valid time, confirm a Page access token with pages_manage_posts and app/business verification in the Meta dashboard.`,
      },
    });
  }
}

function decodeBase64Image(s: string): Buffer {
  const trimmed = s.trim();
  const m = /^data:image\/\w+;base64,(.+)$/i.exec(trimmed);
  const b64 = m ? m[1]! : trimmed;
  return Buffer.from(b64, "base64");
}

function assertPngBuffer(buf: Buffer, slideIndex: number): void {
  if (
    buf.length < 8 ||
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    throw new MetaGraphError({
      error: {
        message: `Slide ${slideIndex} must be PNG data (file header missing). Re-export from the studio.`,
      },
    });
  }
}

async function graphJsonPost(
  version: string,
  path: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const url = `${graphBase(version)}/${path}`;
  const u = new URL(url);
  u.searchParams.set("access_token", accessToken);
  const res = await fetch(u.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readGraphJsonBody(res);
  assertOk(res, data);
  return data;
}

type PhotoInfoJson = MetaGraphErrorBody & {
  source?: string;
  width?: number;
  height?: number;
  picture?: string | { data?: { url?: string } };
  images?: { height?: number; width?: number; source?: string }[];
};

/**
 * Pick the CDN URL Instagram will fetch: prefer largest known pixel area; on ties,
 * prefer `source`, then `images[]` order, then `picture` (usually smallest).
 */
function pickPublicImageUrlFromPhotoNode(info: PhotoInfoJson): string | null {
  type Cand = { url: string; area: number; tier: number };
  const cands: Cand[] = [];
  const images = info.images;
  if (Array.isArray(images)) {
    for (let i = 0; i < images.length; i++) {
      const im = images[i]!;
      const url = typeof im.source === "string" ? im.source : "";
      if (!url) continue;
      const w = im.width ?? 0;
      const h = im.height ?? 0;
      cands.push({ url, area: w * h, tier: 10 + i });
    }
  }
  if (typeof info.source === "string" && info.source.length > 0) {
    const w = info.width ?? 0;
    const h = info.height ?? 0;
    cands.push({ url: info.source, area: w * h, tier: 1 });
  }
  const p = info.picture;
  const picUrl =
    typeof p === "string"
      ? p
      : p && typeof p === "object"
        ? p.data?.url
        : undefined;
  if (typeof picUrl === "string" && picUrl.length > 0) {
    cands.push({ url: picUrl, area: 0, tier: 1000 });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => {
    if (b.area !== a.area) return b.area - a.area;
    return a.tier - b.tier;
  });
  return cands[0]!.url;
}

/** Best-effort delete of staged unpublished Page photos if publish fails before Instagram finishes. */
async function deleteStagedPagePhotosBestEffort(
  version: string,
  accessToken: string,
  photoIds: string[]
): Promise<void> {
  await Promise.allSettled(
    photoIds.map((id) => {
      const u = new URL(`${graphBase(version)}/${id}`);
      u.searchParams.set("access_token", accessToken);
      return fetch(u.toString(), { method: "DELETE" });
    })
  );
}

async function uploadUnpublishedPagePhoto(
  version: string,
  pageId: string,
  accessToken: string,
  image: Buffer,
  mime: "image/png" | "image/jpeg",
  filename: string
): Promise<{ id: string; fullPicture: string }> {
  const form = new FormData();
  form.append("access_token", accessToken);
  form.append("published", "false");
  form.append(
    "source",
    new Blob([new Uint8Array(image)], { type: mime }),
    filename
  );
  const url = `${graphBase(version)}/${pageId}/photos`;
  const res = await fetch(url, { method: "POST", body: form });
  const data = (await readGraphJsonBody(res)) as MetaGraphErrorBody & {
    id?: string;
  };
  assertOk(res, data);
  const id = data.id;
  if (!id || typeof id !== "string") {
    throw new MetaGraphError({
      error: { message: "Page photo upload did not return an id." },
    });
  }

  // `full_picture` is not available on all Photo objects / API versions (#100).
  const infoUrl = new URL(`${graphBase(version)}/${id}`);
  infoUrl.searchParams.set(
    "fields",
    "picture,source,width,height,images{height,width,source}"
  );
  infoUrl.searchParams.set("access_token", accessToken);
  const infoRes = await fetch(infoUrl.toString());
  const info = (await readGraphJsonBody(infoRes)) as PhotoInfoJson;
  assertOk(infoRes, info);
  const imageUrl = pickPublicImageUrlFromPhotoNode(info);
  if (!imageUrl) {
    throw new MetaGraphError({
      error: {
        message:
          "Could not read a public image URL for the uploaded Page photo (images/source/picture).",
      },
    });
  }
  return { id, fullPicture: imageUrl };
}

export async function fetchInstagramBusinessUserId(
  version: string,
  pageId: string,
  accessToken: string
): Promise<string> {
  const u = new URL(`${graphBase(version)}/${pageId}`);
  u.searchParams.set("fields", "instagram_business_account{id}");
  u.searchParams.set("access_token", accessToken);
  const res = await fetch(u.toString());
  const data = (await readGraphJsonBody(res)) as MetaGraphErrorBody & {
    instagram_business_account?: { id?: string };
  };
  assertOk(res, data);
  const igId = data.instagram_business_account?.id;
  if (!igId) {
    throw new MetaGraphError({
      error: {
        message:
          "This Facebook Page has no linked Instagram professional account. Link a Business or Creator Instagram account to the Page in Meta settings.",
      },
    });
  }
  return igId;
}

export type PublishCarouselInput = {
  version: string;
  pageId: string;
  accessToken: string;
  /** Raw base64 or data-URL PNG strings (JSON publish path). Ignored if `imagePngBuffers` is set. */
  imagesBase64?: string[];
  /** Decoded PNG bytes from the app; encoded to JPEG before Graph API upload. */
  imagePngBuffers?: Buffer[];
  caption: string;
  publishInstagram: boolean;
  publishFacebook: boolean;
  /** Unix seconds (UTC). Omit for immediate Instagram publish. */
  scheduledPublishTime?: number;
};

export type PublishCarouselResult = {
  instagramMediaId?: string;
  facebookPostId?: string;
};

/**
 * Validates slides as PNG, re-encodes to high-quality JPEG for smaller uploads, then
 * stages unpublished Page photos so Meta can serve URLs for Instagram `image_url`.
 */
export async function publishCarouselToMeta(
  input: PublishCarouselInput
): Promise<PublishCarouselResult> {
  const {
    version,
    pageId,
    accessToken,
    imagesBase64,
    imagePngBuffers: rawBuffers,
    caption,
    publishInstagram,
    publishFacebook,
    scheduledPublishTime,
  } = input;

  assertInstagramFuturePublishSupported(
    publishInstagram,
    scheduledPublishTime
  );

  let slidePngBuffers: Buffer[] = [];

  if (rawBuffers && rawBuffers.length > 0) {
    slidePngBuffers = rawBuffers;
    for (let i = 0; i < slidePngBuffers.length; i++) {
      assertPngBuffer(slidePngBuffers[i]!, i + 1);
    }
  } else if (imagesBase64 && imagesBase64.length > 0) {
    for (let i = 0; i < imagesBase64.length; i++) {
      try {
        const png = decodeBase64Image(imagesBase64[i]!);
        assertPngBuffer(png, i + 1);
        slidePngBuffers.push(png);
      } catch (e) {
        if (e instanceof MetaGraphError) throw e;
        throw new MetaGraphError({
          error: { message: `Slide ${i + 1} is not valid base64 image data.` },
        });
      }
    }
  } else {
    throw new MetaGraphError({
      error: { message: "At least one slide image is required." },
    });
  }

  if (slidePngBuffers.length > 10) {
    throw new MetaGraphError({
      error: { message: "Instagram carousels support at most 10 items." },
    });
  }

  const slideJpegBuffers: Buffer[] = await Promise.all(
    slidePngBuffers.map(async (png, i) => {
      try {
        return await pngBufferToJpegBuffer(png, META_PUBLISH_JPEG_QUALITY);
      } catch {
        throw new MetaGraphError({
          error: {
            message: `Slide ${i + 1} could not be prepared for upload. Re-export from the studio.`,
          },
        });
      }
    })
  );

  const staged: { photoId: string; imageUrl: string }[] = [];
  let instagramPublishFinished = false;

  try {
    for (let i = 0; i < slideJpegBuffers.length; i++) {
      const { id, fullPicture } = await uploadUnpublishedPagePhoto(
        version,
        pageId,
        accessToken,
        slideJpegBuffers[i]!,
        "image/jpeg",
        "slide.jpg"
      );
      staged.push({ photoId: id, imageUrl: fullPicture });
    }

    const result: PublishCarouselResult = {};

    if (publishInstagram) {
      const igUserId = await fetchInstagramBusinessUserId(
        version,
        pageId,
        accessToken
      );

      const childIds: string[] = [];
      if (staged.length === 1) {
        const body: Record<string, unknown> = {
          image_url: staged[0]!.imageUrl,
          caption: caption.trim(),
        };
        if (scheduledPublishTime != null) {
          body.scheduled_publish_time = scheduledPublishTime;
        }
        const created = await graphJsonPost(
          version,
          `${igUserId}/media`,
          accessToken,
          body
        );
        const creationId = created.id;
        if (typeof creationId !== "string") {
          throw new MetaGraphError({
            error: { message: "Instagram did not return a container id." },
          });
        }
        const pub = await graphJsonPost(
          version,
          `${igUserId}/media_publish`,
          accessToken,
          { creation_id: creationId }
        );
        if (typeof pub.id === "string") result.instagramMediaId = pub.id;
        instagramPublishFinished = true;
      } else {
        for (const { imageUrl } of staged) {
          const item = await graphJsonPost(
            version,
            `${igUserId}/media`,
            accessToken,
            { image_url: imageUrl, is_carousel_item: true }
          );
          const cid = item.id;
          if (typeof cid !== "string") {
            throw new MetaGraphError({
              error: {
                message: "Instagram did not return a carousel item container id.",
              },
            });
          }
          childIds.push(cid);
        }
        const carouselBody: Record<string, unknown> = {
          media_type: "CAROUSEL",
          caption: caption.trim(),
          children: childIds.join(","),
        };
        if (scheduledPublishTime != null) {
          carouselBody.scheduled_publish_time = scheduledPublishTime;
        }
        const carousel = await graphJsonPost(
          version,
          `${igUserId}/media`,
          accessToken,
          carouselBody
        );
        const creationId = carousel.id;
        if (typeof creationId !== "string") {
          throw new MetaGraphError({
            error: { message: "Instagram did not return a carousel container id." },
          });
        }
        const pub = await graphJsonPost(
          version,
          `${igUserId}/media_publish`,
          accessToken,
          { creation_id: creationId }
        );
        if (typeof pub.id === "string") result.instagramMediaId = pub.id;
        instagramPublishFinished = true;
      }
    }

    if (publishFacebook) {
      const attached = staged.map((s) => ({ media_fbid: s.photoId }));
      const feedBody = new URLSearchParams();
      feedBody.set("access_token", accessToken);
      feedBody.set("message", caption.trim());
      // Minimal carousel: only attached_media + top-level message (no child_attachments / CTAs).
      feedBody.set("attached_media", JSON.stringify(attached));
      if (scheduledPublishTime != null) {
        assertFacebookScheduledTimeNotTooSoon(scheduledPublishTime);
        // Required with scheduled_publish_time: otherwise the post is "published" now
        // and Meta returns (#100) You cannot specify a scheduled publish time on a published post.
        feedBody.set("published", "false");
        feedBody.set(
          "scheduled_publish_time",
          String(scheduledPublishTime)
        );
      }
      const feedRes = await fetch(`${graphBase(version)}/${pageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: feedBody.toString(),
      });
      const feedData = (await readGraphJsonBody(feedRes)) as MetaGraphErrorBody & {
        id?: string;
      };
      assertOk(feedRes, feedData);
      if (typeof feedData.id === "string") result.facebookPostId = feedData.id;
    }

    return result;
  } catch (e) {
    if (!instagramPublishFinished && staged.length > 0) {
      await deleteStagedPagePhotosBestEffort(
        version,
        accessToken,
        staged.map((s) => s.photoId)
      );
    }
    throw e;
  }
}

export function getMetaEnv(): {
  token: string;
  pageId: string;
  version: string;
} | null {
  const token = process.env.META_PAGE_ACCESS_TOKEN?.trim() ?? "";
  const pageId = process.env.META_PAGE_ID?.trim() ?? "";
  const version =
    process.env.META_GRAPH_API_VERSION?.trim() || "v21.0";
  if (!token || !pageId) return null;
  return { token, pageId, version };
}
