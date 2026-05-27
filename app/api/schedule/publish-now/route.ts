import { NextResponse } from "next/server";
import { denyIfNotDaemonAuthorized } from "@/lib/schedule/daemon-auth";
import {
  MetaGraphError,
  formatMetaUserFacingMessage,
} from "@/lib/meta/errors";
import { getMetaEnv, publishCarouselToMeta } from "@/lib/meta/publish";
import { publishReelToMeta } from "@/lib/meta/publish-reel";
import { stripEmDashes } from "@/lib/strip-em-dash";
import { getYoutubeAccessTokenFromRefresh } from "@/lib/youtube/access-token";
import { uploadYoutubeVideoResumable } from "@/lib/youtube/upload-resumable";
import { bunnyUrlsFromHubSchedulePayload } from "@/lib/schedule/hub-translator";
import { bunnySlideUrlsForMetaPublish } from "@/lib/schedule/slides-for-meta-from-snapshot";
import {
  parseFirstComment,
  tryPostFirstCommentsAfterPublish,
} from "@/lib/meta/post-first-comment";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/schedule/publish-now
 *
 * Manual "Send to Meta" path. Browser calls this with `{ entryId }` plus
 * an `Authorization: Bearer SCHEDULE_DAEMON_SECRET` header (via
 * `lib/schedule/daemon-client.ts → publishNowViaDaemon`). We fetch the
 * Hub's ScheduleEntry via `/api/v1/internal/schedule/[id]`, publish using
 * Bunny URLs from the Hub schedule payload, and PATCH `postedAt` on success.
 *
 * Phase 4.C — the legacy `.data/daemon-schedule.json` source is gone. Any
 * scheduled entry must be in the Hub by now.
 */

function youtubeTitleFromCaption(caption: string): string {
  const line = caption.split(/\r?\n/).find((l) => l.trim().length > 0);
  const t = (line ?? caption).trim().slice(0, 100);
  return t.length > 0 ? t : "Short";
}

function getHubBase(): string | null {
  const raw = process.env.HUB_API_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

type HubScheduleEntry = {
  id: string;
  userId: string;
  scheduleKind: "post" | "reel" | "short";
  publishAt: string;
  payload: Record<string, unknown>;
  reelVideoStored: boolean;
  postedAt: string | null;
  error: string | null;
  createdAt: string;
};

async function fetchHubEntry(id: string): Promise<HubScheduleEntry | null> {
  const base = getHubBase();
  const secret = process.env.SCHEDULE_DAEMON_SECRET?.trim();
  if (!base || !secret) return null;
  let res: Response;
  try {
    res = await fetch(
      `${base}/api/v1/internal/schedule/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      },
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const j = (await res.json()) as { data?: HubScheduleEntry };
    return j.data ?? null;
  } catch {
    return null;
  }
}

async function markPostedOnHub(
  id: string,
  body: { postedAt?: string; error?: string | null },
): Promise<void> {
  const base = getHubBase();
  const secret = process.env.SCHEDULE_DAEMON_SECRET?.trim();
  if (!base || !secret) return;
  try {
    await fetch(
      `${base}/api/v1/internal/schedule/${encodeURIComponent(id)}/mark-posted`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  } catch (e) {
    console.warn("[publish-now] Hub mark-posted crashed:", e);
  }
}

export async function POST(request: Request) {
  const deny = denyIfNotDaemonAuthorized(request);
  if (deny) return deny;

  let body: { entryId?: string; scheduledPublishTime?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const entryId = typeof body.entryId === "string" ? body.entryId.trim() : "";
  if (!entryId) {
    return NextResponse.json(
      { error: "entryId is required." },
      { status: 400 },
    );
  }

  const env = getMetaEnv();
  const entry = await fetchHubEntry(entryId);
  if (!entry) {
    return NextResponse.json(
      {
        error:
          "Scheduled post not found on the Hub. Re-save it from the Schedule page to sync, then try again.",
      },
      { status: 404 },
    );
  }

  if (entry.postedAt) {
    return NextResponse.json(
      {
        ok: true,
        alreadyPublished: true,
        postedAt: entry.postedAt,
      },
      { status: 200 },
    );
  }

  const rawPayload = (entry.payload ?? {}) as Record<string, unknown>;
  const p = rawPayload as {
    caption?: string;
    firstComment?: string;
    postToInstagram?: boolean;
    postToFacebook?: boolean;
    postToYouTube?: boolean;
    uiScheduleKind?: string;
  };
  const firstComment = parseFirstComment(p.firstComment);
  const bunnyUrls = bunnyUrlsFromHubSchedulePayload(rawPayload);
  const uiKind: "carousel" | "photo" | "short" =
    entry.scheduleKind === "short" ||
    entry.scheduleKind === "reel" ||
    p.uiScheduleKind === "short"
      ? "short"
      : p.uiScheduleKind === "photo"
        ? "photo"
        : "carousel";

  const now = Math.floor(Date.now() / 1000);
  const entryUnix = Math.floor(new Date(entry.publishAt).getTime() / 1000);
  const rawScheduled =
    typeof body.scheduledPublishTime === "number" &&
    Number.isFinite(body.scheduledPublishTime)
      ? body.scheduledPublishTime
      : entryUnix;
  const scheduledPublishTime =
    rawScheduled > now + 600 ? rawScheduled : undefined;

  const caption = stripEmDashes((p.caption ?? "").trim());
  const publishAtIsoUtc =
    scheduledPublishTime != null
      ? new Date(scheduledPublishTime * 1000).toISOString()
      : undefined;
  const postToInstagram = p.postToInstagram === true;
  const postToFacebook = p.postToFacebook === true;
  const postToYouTube = p.postToYouTube === true;

  // ----- Short / Reel ------------------------------------------------------
  if (uiKind === "short") {
    const reelUrl = bunnyUrls?.reelMp4Url;
    if (!reelUrl) {
      return NextResponse.json(
        {
          error:
            "Reel MP4 isn't on Bunny for this entry. Open the Short on the home page so the file uploads, then try again.",
        },
        { status: 409 },
      );
    }
    const wantsMeta = postToInstagram || postToFacebook;
    const wantsYt = postToYouTube;
    if (!wantsMeta && !wantsYt) {
      return NextResponse.json(
        {
          error:
            "Enable Instagram, Facebook, and/or YouTube for this Short before sending.",
        },
        { status: 400 },
      );
    }

    let video: Buffer;
    try {
      const r = await fetch(reelUrl, { cache: "no-store" });
      if (!r.ok) throw new Error(`Bunny fetch ${r.status}`);
      video = Buffer.from(await r.arrayBuffer());
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? `Could not load reel MP4 from Bunny: ${err.message}`
              : "Could not load reel MP4 from Bunny.",
        },
        { status: 502 },
      );
    }

    let instagramMediaId: string | undefined;
    let facebookPostId: string | undefined;
    let youtubeVideoId: string | undefined;
    const errs: string[] = [];

    try {
      if (wantsMeta) {
        if (!env) {
          errs.push("Meta is not configured.");
        } else {
          const reelResult = await publishReelToMeta({
            version: env.version,
            pageId: env.pageId,
            accessToken: env.token,
            video,
            caption,
            publishInstagram: postToInstagram,
            publishFacebook: postToFacebook,
            scheduledPublishTime,
          });
          instagramMediaId = reelResult.instagramMediaId;
          facebookPostId = reelResult.facebookVideoId;
        }
      }
      if (wantsYt && errs.length === 0) {
        try {
          const accessToken = await getYoutubeAccessTokenFromRefresh();
          const ytResult = await uploadYoutubeVideoResumable({
            accessToken,
            video,
            title: youtubeTitleFromCaption(caption),
            description: caption,
            ...(publishAtIsoUtc ? { publishAtIsoUtc } : {}),
          });
          youtubeVideoId = ytResult?.videoId;
        } catch (ytErr) {
          errs.push(
            ytErr instanceof Error ? ytErr.message : "YouTube upload failed.",
          );
        }
      }
      if (errs.length > 0) {
        const msg = errs.join(" ");
        const anyPublished = Boolean(
          instagramMediaId || facebookPostId || youtubeVideoId,
        );
        // If a platform already published, mark posted so neither this path nor
        // the daemon re-posts it (avoids duplicates). Else leave it for retry.
        await markPostedOnHub(
          entryId,
          anyPublished
            ? {
                postedAt: new Date(now * 1000).toISOString(),
                error: `Partially published (not retried to avoid duplicates): ${msg}`,
              }
            : { error: msg },
        );
        return NextResponse.json({ error: msg }, { status: 502 });
      }
      await markPostedOnHub(entryId, {
        postedAt: new Date(now * 1000).toISOString(),
        error: null,
      });
      const firstCommentExtras = await tryPostFirstCommentsAfterPublish({
        env,
        firstComment,
        postToInstagram,
        postToFacebook,
        instagramMediaId,
        facebookPostId,
        facebookVideoId: facebookPostId,
        defer: scheduledPublishTime != null,
      });
      return NextResponse.json(
        {
          ok: true,
          instagramMediaId,
          facebookPostId,
          youtubeVideoId,
          ...firstCommentExtras,
        },
        { status: 200 },
      );
    } catch (err) {
      const msg =
        err instanceof MetaGraphError
          ? formatMetaUserFacingMessage(err)
          : err instanceof Error
            ? err.message
            : "Unknown error";
      await markPostedOnHub(entryId, { error: msg });
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  // ----- Carousel / Photo --------------------------------------------------
  const bunnySlides = bunnySlideUrlsForMetaPublish(
    bunnyUrls,
    postToInstagram,
    postToFacebook,
    uiKind === "photo" ? "photo" : "carousel",
  );
  if (!bunnySlides) {
    return NextResponse.json(
      {
        error:
          uiKind === "photo"
            ? "Photo image isn't on Bunny for this entry. Open the video on the home page so the image post uploads, then try again."
            : "Slides aren't on Bunny for this entry. Open the video on the home page so the slides upload, then try again.",
      },
      { status: 409 },
    );
  }
  if (!env) {
    return NextResponse.json(
      { error: "Meta is not configured." },
      { status: 503 },
    );
  }

  try {
    const imagePngBuffers = await Promise.all(
      bunnySlides.map(async (url) => {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`Bunny fetch ${r.status} ${url}`);
        return Buffer.from(await r.arrayBuffer());
      }),
    );

    const result = await publishCarouselToMeta({
      version: env.version,
      pageId: env.pageId,
      accessToken: env.token,
      imagePngBuffers,
      caption,
      publishInstagram: postToInstagram,
      publishFacebook: postToFacebook,
      scheduledPublishTime,
    });
    await markPostedOnHub(entryId, {
      postedAt: new Date(now * 1000).toISOString(),
      error: null,
    });
    const firstCommentExtras = await tryPostFirstCommentsAfterPublish({
      env,
      firstComment,
      postToInstagram,
      postToFacebook,
      instagramMediaId: result.instagramMediaId,
      facebookPostId: result.facebookPostId,
      defer: scheduledPublishTime != null,
    });
    return NextResponse.json(
      {
        ok: true,
        instagramMediaId: result.instagramMediaId,
        facebookPostId: result.facebookPostId,
        ...firstCommentExtras,
      },
      { status: 200 },
    );
  } catch (err) {
    const msg =
      err instanceof MetaGraphError
        ? formatMetaUserFacingMessage(err)
        : err instanceof Error
          ? err.message
          : "Unknown error";
    await markPostedOnHub(entryId, { error: msg });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
