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
import type { BunnyAssetUrls } from "@/lib/storage/bunny-upload-client";
import { bunnyUrlsFromHubSchedulePayload } from "@/lib/schedule/hub-translator";
import { bunnySlideUrlsForMetaPublish } from "@/lib/schedule/slides-for-meta-from-snapshot";
import {
  parseFirstComment,
  tryPostFirstCommentsAfterPublish,
} from "@/lib/meta/post-first-comment";

export const runtime = "nodejs";
export const maxDuration = 300;

function youtubeTitleFromCaption(caption: string): string {
  const line = caption.split(/\r?\n/).find((l) => l.trim().length > 0);
  const t = (line ?? caption).trim().slice(0, 100);
  return t.length > 0 ? t : "Short";
}

function getHubBase(): string | null {
  const raw = process.env.HUB_API_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

/** Normalised shape every publish source funnels into. */
type PublishableEntry = {
  id: string;
  scheduleKind: "carousel" | "photo" | "short";
  publishAtUnix: number;
  caption: string;
  postToInstagram: boolean;
  postToFacebook: boolean;
  postToYouTube: boolean;
  bunnyUrls?: BunnyAssetUrls;
  firstComment?: string;
};

type PublishOk = {
  ok: true;
  instagramMediaId?: string;
  facebookPostId?: string;
  youtubeVideoId?: string;
  firstCommentErrors?: string[];
  firstCommentDeferred?: boolean;
};
type PublishFail = {
  ok: false;
  message: string;
  instagramMediaId?: string;
  facebookPostId?: string;
  youtubeVideoId?: string;
};
type PublishResult = PublishOk | PublishFail;

/**
 * Single source-of-truth publish helper. Both the Hub loop and the .data/
 * loop call this with a normalised entry — keeps the publish logic from
 * drifting between paths.
 */
async function publishOne(
  e: PublishableEntry,
  env: ReturnType<typeof getMetaEnv>,
): Promise<PublishResult> {
  const caption = stripEmDashes(e.caption.trim());

  // ----- Short (Reel + optional YouTube) ----------------------------------
  if (e.scheduleKind === "short") {
    const wantsMeta = e.postToInstagram || e.postToFacebook;
    const wantsYt = e.postToYouTube === true;
    if (!wantsMeta && !wantsYt) {
      return {
        ok: false,
        message:
          "Enable Instagram and/or Facebook and/or YouTube for this Short.",
      };
    }
    const reelUrl = e.bunnyUrls?.reelMp4Url;
    if (!reelUrl) {
      return {
        ok: false,
        message:
          "Reel MP4 is not available (no Bunny URL on the schedule entry).",
      };
    }
    let video: Buffer;
    try {
      const r = await fetch(reelUrl, { cache: "no-store" });
      if (!r.ok) throw new Error(`Bunny fetch ${r.status} ${reelUrl}`);
      video = Buffer.from(await r.arrayBuffer());
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error
            ? `Could not load reel MP4: ${err.message}`
            : "Reel MP4 fetch failed.",
      };
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
            publishInstagram: e.postToInstagram,
            publishFacebook: e.postToFacebook,
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
          });
          youtubeVideoId = ytResult?.videoId;
        } catch (ytErr) {
          errs.push(
            ytErr instanceof Error ? ytErr.message : "YouTube upload failed.",
          );
        }
      }
      if (errs.length > 0)
        return {
          ok: false,
          message: errs.join(" "),
          // Surface any platform that DID publish so the caller can mark the
          // entry posted and never re-post duplicates on the next tick.
          instagramMediaId,
          facebookPostId,
          youtubeVideoId,
        };
      const firstCommentExtras = await tryPostFirstCommentsAfterPublish({
        env,
        firstComment: e.firstComment,
        postToInstagram: e.postToInstagram,
        postToFacebook: e.postToFacebook,
        instagramMediaId,
        facebookPostId,
        facebookVideoId: facebookPostId,
      });
      return {
        ok: true,
        instagramMediaId,
        facebookPostId,
        youtubeVideoId,
        ...firstCommentExtras,
      };
    } catch (err) {
      const msg =
        err instanceof MetaGraphError
          ? formatMetaUserFacingMessage(err)
          : err instanceof Error
            ? err.message
            : "Unknown error";
      return { ok: false, message: msg };
    }
  }

  // ----- Carousel / Photo --------------------------------------------------
  if (!env) return { ok: false, message: "Meta is not configured." };

  const bunnySlides = bunnySlideUrlsForMetaPublish(
    e.bunnyUrls,
    e.postToInstagram,
    e.postToFacebook,
    e.scheduleKind === "photo" ? "photo" : "carousel",
  );
  if (!bunnySlides) {
    return {
      ok: false,
      message:
        e.scheduleKind === "photo"
          ? "Photo image is missing (no imagePostUrl on the schedule entry — open the video on the home page so the image uploads to Bunny)."
          : "Slides are missing (no Bunny URLs on the schedule entry — re-process the video on the home page).",
    };
  }
  let imagePngBuffers: Buffer[];
  try {
    imagePngBuffers = await Promise.all(
      bunnySlides.map(async (url) => {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`Bunny fetch ${r.status} ${url}`);
        return Buffer.from(await r.arrayBuffer());
      }),
    );
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Could not fetch slides from Bunny.",
    };
  }

  try {
    const result = await publishCarouselToMeta({
      version: env.version,
      pageId: env.pageId,
      accessToken: env.token,
      imagePngBuffers,
      caption,
      publishInstagram: e.postToInstagram,
      publishFacebook: e.postToFacebook,
    });
    const firstCommentExtras = await tryPostFirstCommentsAfterPublish({
      env,
      firstComment: e.firstComment,
      postToInstagram: e.postToInstagram,
      postToFacebook: e.postToFacebook,
      instagramMediaId: result.instagramMediaId,
      facebookPostId: result.facebookPostId,
    });
    return {
      ok: true,
      instagramMediaId: result.instagramMediaId,
      facebookPostId: result.facebookPostId,
      ...firstCommentExtras,
    };
  } catch (err) {
    const msg =
      err instanceof MetaGraphError
        ? formatMetaUserFacingMessage(err)
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { ok: false, message: msg };
  }
}

/**
 * Pull due ScheduleEntry rows from the Hub via the internal shared-secret
 * endpoint. Returns null if the Hub call fails — caller falls back to the
 * .data/daemon-schedule.json loop below.
 */
async function fetchDueFromHub(): Promise<
  Array<{ id: string; payload: Record<string, unknown>; scheduleKind: string; publishAt: string; reelVideoStored: boolean }> | null
> {
  const base = getHubBase();
  if (!base) return null;
  const secret = process.env.SCHEDULE_DAEMON_SECRET?.trim();
  if (!secret) return null;
  try {
    const res = await fetch(`${base}/api/v1/internal/schedule/due`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit: 100 }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[publish-due] Hub /due failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const j = (await res.json()) as {
      data?: Array<{ id: string; payload: Record<string, unknown>; scheduleKind: string; publishAt: string; reelVideoStored: boolean }>;
    };
    return Array.isArray(j.data) ? j.data : [];
  } catch (e) {
    console.warn("[publish-due] Hub /due crashed:", e);
    return null;
  }
}

async function markPostedOnHub(
  id: string,
  body: { postedAt?: string; error?: string | null },
): Promise<void> {
  const base = getHubBase();
  if (!base) return;
  const secret = process.env.SCHEDULE_DAEMON_SECRET?.trim();
  if (!secret) return;
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
    console.warn("[publish-due] Hub mark-posted crashed:", e);
  }
}

function hubEntryToPublishable(row: {
  id: string;
  payload: Record<string, unknown>;
  scheduleKind: string;
  publishAt: string;
}): PublishableEntry {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const uiKind = typeof p.uiScheduleKind === "string" ? p.uiScheduleKind : null;
  const scheduleKind: "carousel" | "photo" | "short" =
    row.scheduleKind === "short" ||
    row.scheduleKind === "reel" ||
    uiKind === "short"
      ? "short"
      : uiKind === "photo"
        ? "photo"
        : "carousel";
  return {
    id: row.id,
    scheduleKind,
    publishAtUnix: Math.floor(new Date(row.publishAt).getTime() / 1000),
    caption: typeof p.caption === "string" ? p.caption : "",
    postToInstagram: p.postToInstagram === true,
    postToFacebook: p.postToFacebook === true,
    postToYouTube: p.postToYouTube === true,
    bunnyUrls: bunnyUrlsFromHubSchedulePayload(p),
    firstComment: parseFirstComment(p.firstComment),
  };
}

/**
 * Called every few minutes by launchd + scripts/publish-due.sh.
 *
 * Phase 4.C: Hub is the sole source of truth. The Multiplier asks the
 * Hub's internal `/api/v1/internal/schedule/due` for due entries,
 * publishes each one via Bunny URLs in payload, and PATCHes `postedAt`
 * on the Hub. The legacy `.data/daemon-schedule.json` fallback has been
 * removed — any historical entries that lived only on disk are no longer
 * picked up. If you have stuck legacy entries, re-save them from Schedule.
 */
export async function POST(request: Request) {
  const deny = denyIfNotDaemonAuthorized(request);
  if (deny) return deny;

  const env = getMetaEnv();
  const now = Math.floor(Date.now() / 1000);
  const staleBefore = now - 14 * 24 * 60 * 60;
  const checkedAt = now;
  const results: { id: string; ok: boolean; detail?: string }[] = [];

  const hubRows = await fetchDueFromHub();
  if (!hubRows) {
    return NextResponse.json(
      {
        ok: false,
        checkedAt,
        error:
          "Could not reach Hub /api/v1/internal/schedule/due. Check HUB_API_URL + SCHEDULE_DAEMON_SECRET env.",
      },
      { status: 502 },
    );
  }

  for (const row of hubRows) {
    const entry = hubEntryToPublishable(row);
    if (entry.publishAtUnix > now) continue;
    if (entry.publishAtUnix < staleBefore) {
      await markPostedOnHub(entry.id, {
        error: "Skipped: older than 14 days past due.",
      });
      results.push({
        id: entry.id,
        ok: false,
        detail: "Skipped (older than 14 days past due).",
      });
      continue;
    }
    const r = await publishOne(entry, env);
    if (r.ok) {
      await markPostedOnHub(entry.id, {
        postedAt: new Date(checkedAt * 1000).toISOString(),
        error: null,
      });
      const detail =
        r.firstCommentErrors?.length || r.firstCommentDeferred
          ? [
              r.firstCommentDeferred
                ? "First comment deferred (post not live yet)."
                : null,
              r.firstCommentErrors?.length
                ? `First comment: ${r.firstCommentErrors.join(" ")}`
                : null,
            ]
              .filter(Boolean)
              .join(" ")
          : undefined;
      results.push({ id: entry.id, ok: true, ...(detail ? { detail } : {}) });
    } else if (r.instagramMediaId || r.facebookPostId || r.youtubeVideoId) {
      // Partial publish: at least one platform is already live. Mark the entry
      // posted so the daemon NEVER re-publishes it — that partial-retry loop is
      // what spammed duplicate IG/FB posts. Record the failing step instead.
      await markPostedOnHub(entry.id, {
        postedAt: new Date(checkedAt * 1000).toISOString(),
        error: `Partially published (not retried to avoid duplicates): ${r.message}`,
      });
      results.push({
        id: entry.id,
        ok: false,
        detail: `Partially published; marked done to avoid duplicates. ${r.message}`,
      });
    } else {
      // Nothing published — safe to retry next tick (no duplicate risk).
      await markPostedOnHub(entry.id, { error: r.message });
      results.push({ id: entry.id, ok: false, detail: r.message });
    }
  }

  return NextResponse.json({
    ok: true,
    checkedAt,
    hubCount: hubRows.length,
    results,
  });
}
