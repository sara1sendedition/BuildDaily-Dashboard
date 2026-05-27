import { v4 as uuidv4 } from "uuid";
import { isLikelyVideoFile } from "@/lib/is-likely-video-file";
import { uploadFileToBunnyStorage } from "@/lib/storage/bunny-upload-client";

/** Prefix for `queueItemId` on rows scheduled from a calendar upload (not the home queue). */
export const EXTERNAL_CALENDAR_QUEUE_PREFIX = "ext-cal:";

export type ExternalCalendarVideo = {
  id: string;
  file: File;
  /** Cached after a successful Bunny upload (e.g. retry schedule). */
  bunnyReelUrl?: string;
};

export function isExternalCalendarQueueId(queueItemId: string): boolean {
  return queueItemId.startsWith(EXTERNAL_CALENDAR_QUEUE_PREFIX);
}

export function externalVideoLabel(file: File): string {
  return file.name.trim() || "video.mp4";
}

export function displayHookFromExternalVideo(file: File): string {
  const stem = file.name.replace(/\.[^/.]+$/, "").trim();
  return stem || file.name || "Short";
}

export function createExternalCalendarVideo(file: File): ExternalCalendarVideo {
  return {
    id: `${EXTERNAL_CALENDAR_QUEUE_PREFIX}${uuidv4()}`,
    file,
  };
}

export function filterExternalCalendarVideos(files: File[]): ExternalCalendarVideo[] {
  return files.filter(isLikelyVideoFile).map(createExternalCalendarVideo);
}

export type ScheduleDragPayload =
  | { queueItemId: string; scheduleKind?: "carousel" | "photo" | "short" }
  | { externalVideoId: string; scheduleKind: "short" };

export function scheduleDragPayload(
  payload: ScheduleDragPayload
): string {
  return JSON.stringify(payload);
}

export function parseScheduleDragPayload(
  raw: string
): ScheduleDragPayload | null {
  if (!raw) return null;
  const t = raw.trim();
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as {
        queueItemId?: string;
        externalVideoId?: string;
        scheduleKind?: string;
      };
      const extId = j.externalVideoId;
      if (typeof extId === "string" && extId.length > 0) {
        return { externalVideoId: extId, scheduleKind: "short" };
      }
      const id = j.queueItemId;
      if (typeof id !== "string" || id.length === 0) return null;
      const k = j.scheduleKind;
      if (k === "carousel" || k === "photo" || k === "short") {
        return { queueItemId: id, scheduleKind: k };
      }
      return { queueItemId: id };
    } catch {
      return null;
    }
  }
  if (/^[0-9a-f-]{36}$/i.test(t)) {
    return { queueItemId: t };
  }
  return null;
}

/** Upload reel MP4 to Bunny; reuses cached URL when present. */
export async function uploadExternalCalendarReel(
  video: ExternalCalendarVideo
): Promise<{ bunnyReelUrl: string } | { error: string }> {
  const cached = video.bunnyReelUrl?.trim();
  if (cached) return { bunnyReelUrl: cached };

  const url = await uploadFileToBunnyStorage(video.file, {
    filename: `${video.id.replace(/^ext-cal:/, "")}/reel.mp4`,
    contentType: video.file.type || "video/mp4",
  });
  if (!url) {
    return {
      error:
        "Could not upload the video to storage. Check your connection and try again.",
    };
  }
  return { bunnyReelUrl: url };
}
