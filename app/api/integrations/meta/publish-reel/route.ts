import { NextResponse } from "next/server";
import {
  MetaGraphError,
  formatMetaUserFacingMessage,
} from "@/lib/meta/errors";
import { getMaxReelUploadBytes } from "@/lib/meta/publish-limits";
import { getMetaEnv } from "@/lib/meta/publish";
import { publishReelToMeta } from "@/lib/meta/publish-reel";
import {
  parseScheduledField,
  futureScheduledOrUndefined,
} from "@/lib/meta/parse-scheduled-field";
import { stripEmDashes } from "@/lib/strip-em-dash";

export const runtime = "nodejs";
export const maxDuration = 300;

function formBool(
  v: FormDataEntryValue | null,
  defaultTrue: boolean
): boolean {
  if (v == null) return defaultTrue;
  const s = String(v).toLowerCase().trim();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return defaultTrue;
}

export async function POST(request: Request) {
  const env = getMetaEnv();
  if (!env) {
    return NextResponse.json(
      {
        error:
          "Meta is not configured. Set META_PAGE_ACCESS_TOKEN and META_PAGE_ID in .env.local.",
      },
      { status: 503 }
    );
  }

  const maxBytes = getMaxReelUploadBytes();
  const cl = request.headers.get("content-length");
  if (cl) {
    const n = parseInt(cl, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      const mb = Math.round((n / (1024 * 1024)) * 10) / 10;
      const maxMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
      return NextResponse.json(
        {
          error: `Video upload is too large (~${mb}MB). Limit ~${maxMb}MB. Set META_REEL_MAX_BODY_BYTES to raise it (self-hosted).`,
        },
        { status: 413 }
      );
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    console.error("[meta/publish-reel] formData", e);
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
      {
        error: `Video is too large (~${mb}MB). Limit ~${maxMb}MB.`,
      },
      { status: 413 }
    );
  }

  const captionRaw = String(form.get("caption") ?? "").trim();
  const caption = stripEmDashes(captionRaw);
  const publishInstagram = formBool(form.get("publishInstagram"), true);
  const publishFacebook = formBool(form.get("publishFacebook"), false);
  if (!publishInstagram && !publishFacebook) {
    return NextResponse.json(
      { error: "Enable at least one of Instagram or Facebook." },
      { status: 400 }
    );
  }

  // A scheduled time in the past (or within ~10 min) means "publish now":
  // don't forward it to Meta, or Instagram rejects it as a (non-allowlisted)
  // native-schedule request. Mirrors /api/schedule/publish-now.
  const scheduledPublishTime = futureScheduledOrUndefined(
    parseScheduledField(
      String(form.get("scheduledPublishTime") ?? "").trim() || undefined
    )
  );

  let buf: Buffer;
  try {
    const ab = await video.arrayBuffer();
    buf = Buffer.from(ab);
  } catch (e) {
    console.error("[meta/publish-reel] buffer", e);
    return NextResponse.json(
      { error: "Could not read video bytes." },
      { status: 400 }
    );
  }

  try {
    const result = await publishReelToMeta({
      version: env.version,
      pageId: env.pageId,
      accessToken: env.token,
      video: buf,
      caption,
      publishInstagram,
      publishFacebook,
      scheduledPublishTime,
    });
    return NextResponse.json({
      instagramMediaId: result.instagramMediaId,
      facebookVideoId: result.facebookVideoId,
    });
  } catch (e) {
    if (e instanceof MetaGraphError) {
      return NextResponse.json(
        { error: formatMetaUserFacingMessage(e), meta: e.body },
        { status: 502 }
      );
    }
    console.error("[meta/publish-reel]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Publish failed." },
      { status: 500 }
    );
  }
}
