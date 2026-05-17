import { NextResponse } from "next/server";
import { denyIfNotDaemonAuthorized } from "@/lib/schedule/daemon-auth";
import {
  MetaGraphError,
  formatMetaUserFacingMessage,
} from "@/lib/meta/errors";
import { getMetaEnv, publishCarouselToMeta } from "@/lib/meta/publish";
import { publishReelToMeta } from "@/lib/meta/publish-reel";
import {
  isDaemonCarouselOrPhotoPublishable,
  isDaemonReelPublishable,
  type DaemonScheduleEntry,
} from "@/lib/schedule/daemon-schema";
import { deleteDaemonReelVideo, readDaemonReelVideo } from "@/lib/schedule/daemon-reel-storage";
import { readDaemonSchedule, writeDaemonSchedule } from "@/lib/schedule/daemon-store";
import { getYoutubeAccessTokenFromRefresh } from "@/lib/youtube/access-token";
import { uploadYoutubeVideoResumable } from "@/lib/youtube/upload-resumable";

export const runtime = "nodejs";
export const maxDuration = 300;

function youtubeTitleFromCaption(caption: string): string {
  const line = caption.split(/\r?\n/).find((l) => l.trim().length > 0);
  const t = (line ?? caption).trim().slice(0, 100);
  return t.length > 0 ? t : "Short";
}

/**
 * Called every few minutes by launchd + scripts/publish-due.sh.
 * Publishes **immediately** to Meta (no native scheduled_publish_time) for rows whose
 * `publishAtUnix` is in the past: carousel/photo via `publishSlidesBase64`, Short/Reels
 * via `.data/daemon-reels/{id}.mp4` after `daemon-upsert-reel`. Shorts may also upload to
 * YouTube when `postToYouTube` is true.
 */
export async function POST(request: Request) {
  const deny = denyIfNotDaemonAuthorized(request);
  if (deny) return deny;

  const env = getMetaEnv();

  const now = Math.floor(Date.now() / 1000);
  const staleBefore = now - 14 * 24 * 60 * 60;
  const list = await readDaemonSchedule();
  const results: { id: string; ok: boolean; detail?: string }[] = [];
  let changed = false;

  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    if (e.daemonPublishedAt != null && e.daemonPublishedAt > 0) continue;
    if (e.publishAtUnix > now) continue;
    if (e.publishAtUnix < staleBefore) {
      results.push({
        id: e.id,
        ok: false,
        detail: "Skipped (older than 14 days past due).",
      });
      continue;
    }
    if (e.scheduleKind === "short") {
      if (!isDaemonReelPublishable(e)) {
        results.push({
          id: e.id,
          ok: false,
          detail:
            "Skipped (no reel MP4 on server — open Schedule and save again with the daemon secret set).",
        });
        continue;
      }
      let video: Buffer;
      try {
        video = await readDaemonReelVideo(e.id);
      } catch {
        results.push({
          id: e.id,
          ok: false,
          detail: "Skipped (reel MP4 file missing on disk — re-save from Schedule).",
        });
        continue;
      }
      const wantsMeta = e.postToInstagram || e.postToFacebook;
      const wantsYt = e.postToYouTube === true;
      if (!wantsMeta && !wantsYt) {
        results.push({
          id: e.id,
          ok: false,
          detail:
            "Skipped (enable Instagram and/or Facebook and/or YouTube for this Short).",
        });
        continue;
      }
      const errs: string[] = [];
      try {
        if (wantsMeta) {
          if (!env) {
            errs.push("Meta is not configured.");
          } else {
            await publishReelToMeta({
              version: env.version,
              pageId: env.pageId,
              accessToken: env.token,
              video,
              caption: e.caption.trim(),
              publishInstagram: e.postToInstagram,
              publishFacebook: e.postToFacebook,
            });
          }
        }
        if (wantsYt && errs.length === 0) {
          try {
            const accessToken = await getYoutubeAccessTokenFromRefresh();
            await uploadYoutubeVideoResumable({
              accessToken,
              video,
              title: youtubeTitleFromCaption(e.caption),
              description: e.caption.trim(),
            });
          } catch (ytErr) {
            errs.push(
              ytErr instanceof Error ? ytErr.message : "YouTube upload failed."
            );
          }
        }
        if (errs.length > 0) {
          const msg = errs.join(" ");
          const next: DaemonScheduleEntry = {
            ...e,
            daemonLastError: msg,
          };
          list[i] = next;
          changed = true;
          results.push({ id: e.id, ok: false, detail: msg });
        } else {
          await deleteDaemonReelVideo(e.id);
          const next: DaemonScheduleEntry = {
            ...e,
            daemonPublishedAt: now,
            daemonLastError: undefined,
            reelVideoStored: false,
          };
          list[i] = next;
          changed = true;
          results.push({ id: e.id, ok: true });
        }
      } catch (err) {
        const msg =
          err instanceof MetaGraphError
            ? formatMetaUserFacingMessage(err)
            : err instanceof Error
              ? err.message
              : "Unknown error";
        const next: DaemonScheduleEntry = {
          ...e,
          daemonLastError: msg,
        };
        list[i] = next;
        changed = true;
        results.push({ id: e.id, ok: false, detail: msg });
      }
      continue;
    }

    if (!isDaemonCarouselOrPhotoPublishable(e)) {
      results.push({
        id: e.id,
        ok: false,
        detail:
          "Skipped (missing publishSlidesBase64 — re-save from Schedule after upgrading).",
      });
      continue;
    }

    if (!env) {
      results.push({
        id: e.id,
        ok: false,
        detail: "Skipped (Meta is not configured).",
      });
      continue;
    }
    try {
      await publishCarouselToMeta({
        version: env.version,
        pageId: env.pageId,
        accessToken: env.token,
        imagesBase64: e.publishSlidesBase64,
        caption: e.caption.trim(),
        publishInstagram: e.postToInstagram,
        publishFacebook: e.postToFacebook,
        // Immediate publish when this endpoint runs (no Meta native schedule).
      });
      const next: DaemonScheduleEntry = {
        ...e,
        daemonPublishedAt: now,
        daemonLastError: undefined,
      };
      list[i] = next;
      changed = true;
      results.push({ id: e.id, ok: true });
    } catch (err) {
      const msg =
        err instanceof MetaGraphError
          ? formatMetaUserFacingMessage(err)
          : err instanceof Error
            ? err.message
            : "Unknown error";
      const next: DaemonScheduleEntry = {
        ...e,
        daemonLastError: msg,
      };
      list[i] = next;
      changed = true;
      results.push({ id: e.id, ok: false, detail: msg });
    }
  }

  if (changed) {
    await writeDaemonSchedule(list);
  }

  return NextResponse.json({
    ok: true,
    checkedAt: now,
    results,
  });
}
