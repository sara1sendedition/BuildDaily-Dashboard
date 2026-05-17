import { NextResponse } from "next/server";
import { denyIfNotDaemonAuthorized } from "@/lib/schedule/daemon-auth";
import type { DaemonScheduleEntry } from "@/lib/schedule/daemon-schema";
import { saveDaemonReelVideo } from "@/lib/schedule/daemon-reel-storage";
import { upsertDaemonEntry } from "@/lib/schedule/daemon-store";
import { getMaxReelUploadBytes } from "@/lib/meta/publish-limits";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseEntryJson(raw: string): DaemonScheduleEntry | null {
  try {
    const o = JSON.parse(raw) as DaemonScheduleEntry;
    if (typeof o !== "object" || o === null || typeof o.id !== "string") {
      return null;
    }
    if (o.scheduleKind !== "short") return null;
    return o;
  } catch {
    return null;
  }
}

/**
 * Multipart: `entry` (JSON string of {@link DaemonScheduleEntry} without reel bytes)
 * and `video` (MP4). Saves `.data/daemon-reels/{id}.mp4` and upserts the row with
 * `reelVideoStored: true`.
 */
export async function POST(request: Request) {
  const deny = denyIfNotDaemonAuthorized(request);
  if (deny) return deny;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const entryRaw = form.get("entry");
  if (typeof entryRaw !== "string") {
    return NextResponse.json({ error: "Form field `entry` (JSON string) is required." }, { status: 400 });
  }
  const base = parseEntryJson(entryRaw);
  if (!base) {
    return NextResponse.json(
      { error: "`entry` must be valid JSON with id and scheduleKind \"short\"." },
      { status: 400 }
    );
  }

  const video = form.get("video");
  if (!(video instanceof File) || video.size <= 0) {
    return NextResponse.json({ error: "Form field `video` (non-empty MP4) is required." }, { status: 400 });
  }

  const maxBytes = getMaxReelUploadBytes();
  if (video.size > maxBytes) {
    return NextResponse.json(
      {
        error: `Video too large (${video.size} bytes). Limit is ${maxBytes} bytes (META_REEL_MAX_BODY_BYTES).`,
      },
      { status: 413 }
    );
  }

  const buf = Buffer.from(await video.arrayBuffer());
  await saveDaemonReelVideo(base.id, buf);

  const entry: DaemonScheduleEntry = {
    ...base,
    publishSlidesBase64: undefined,
    reelVideoStored: true,
  };
  await upsertDaemonEntry(entry);

  return NextResponse.json({ ok: true });
}
