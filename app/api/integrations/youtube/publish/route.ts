import { NextResponse } from "next/server";
import { getMaxReelUploadBytes } from "@/lib/meta/publish-limits";
import { futureScheduledOrUndefined } from "@/lib/meta/parse-scheduled-field";
import { getYoutubeAccessTokenFromRefresh } from "@/lib/youtube/access-token";
import { uploadYoutubeVideoResumable } from "@/lib/youtube/upload-resumable";

export const runtime = "nodejs";
export const maxDuration = 300;

function firstLineTitle(caption: string, fallback: string): string {
  const line = caption.split(/\r?\n/).find((l) => l.trim().length > 0);
  const t = (line ?? caption).trim().slice(0, 100);
  return t.length > 0 ? t : fallback;
}

export async function POST(request: Request) {
  const maxBytes = getMaxReelUploadBytes();
  const cl = request.headers.get("content-length");
  if (cl) {
    const n = parseInt(cl, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      const mb = Math.round((n / (1024 * 1024)) * 10) / 10;
      const maxMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
      return NextResponse.json(
        {
          error: `Video upload is too large (~${mb}MB). Limit ~${maxMb}MB (same cap as Meta reels; set META_REEL_MAX_BODY_BYTES to raise).`,
        },
        { status: 413 }
      );
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    console.error("[youtube/publish] formData", e);
    return NextResponse.json(
      { error: "Could not read multipart body." },
      { status: 400 }
    );
  }

  const video = form.get("video");
  if (!(video instanceof Blob) || video.size < 16) {
    return NextResponse.json(
      { error: "Missing or empty video file." },
      { status: 400 }
    );
  }

  if (video.size > maxBytes) {
    const mb = Math.round((video.size / (1024 * 1024)) * 10) / 10;
    const maxMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
    return NextResponse.json(
      { error: `Video is too large (~${mb}MB). Limit ~${maxMb}MB.` },
      { status: 413 }
    );
  }

  const caption = String(form.get("caption") ?? "").trim();
  const scheduledRaw = form.get("scheduledPublishTime");
  let publishAtIsoUtc: string | undefined;
  if (scheduledRaw != null && String(scheduledRaw).trim() !== "") {
    const unix = parseInt(String(scheduledRaw), 10);
    // Past/near times mean "publish now" — leave publishAtIsoUtc unset so the
    // video goes public immediately (YouTube rejects a past publishAt).
    const future = futureScheduledOrUndefined(
      Number.isFinite(unix) ? unix : undefined
    );
    if (future) {
      publishAtIsoUtc = new Date(future * 1000).toISOString();
    }
  }

  let accessToken: string;
  try {
    accessToken = await getYoutubeAccessTokenFromRefresh();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "YouTube auth failed.";
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  const buf = Buffer.from(await video.arrayBuffer());
  const title = firstLineTitle(caption, "Short");

  try {
    const { videoId } = await uploadYoutubeVideoResumable({
      accessToken,
      video: buf,
      title,
      description: caption,
      publishAtIsoUtc,
    });
    return NextResponse.json({ youtubeVideoId: videoId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "YouTube upload failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
