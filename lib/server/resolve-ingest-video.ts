import * as fs from "fs/promises";
import { isAllowedSourceVideoUrl } from "@/lib/allowed-source-video-url";
import { fetchUrlToFile } from "@/lib/fetch-url-to-file";
import {
  downloadDriveSourceToPath,
  downloadStitchJobOutputToPath,
} from "@/lib/server/drive-inbox-fetch";

type EnsureIngestVideoOptions = {
  /** Per-route fetch timeout when pulling from Bunny (ms). */
  fetchTimeoutMs?: number;
};

/**
 * After multipart parse: ensure `videoPath` contains bytes from upload, Drive,
 * or an allowed `sourceVideoUrl` (also handles zero-byte browser placeholders).
 */
export async function ensureIngestVideoOnDisk(
  videoPath: string,
  fields: Record<string, string>,
  videoUploaded: boolean,
  options?: EnsureIngestVideoOptions
): Promise<void> {
  // Large stitch uploads commonly exceed 4 minutes on Bunny pulls.
  const fetchTimeoutMs = options?.fetchTimeoutMs ?? 600_000;

  const resolveSourceVideoUrl = (): string => {
    const sourceUrl = String(fields.sourceVideoUrl ?? "").trim();
    if (!sourceUrl) {
      throw new Error("Missing source video URL");
    }
    if (!isAllowedSourceVideoUrl(sourceUrl)) {
      throw new Error("Source video URL is not from an allowed storage host");
    }
    return sourceUrl;
  };

  const driveFileId = String(fields.driveFileId ?? "").trim();
  const sourceJobId = String(fields.sourceJobId ?? "").trim();
  const stitchJobId = String(fields.stitchJobId ?? "").trim();
  const fetchServerSideVideo = async (): Promise<void> => {
    if (stitchJobId) {
      await downloadStitchJobOutputToPath(stitchJobId, videoPath);
      return;
    }
    if (driveFileId || sourceJobId) {
      await downloadDriveSourceToPath({ sourceJobId, driveFileId }, videoPath);
      return;
    }
    await fetchUrlToFile(resolveSourceVideoUrl(), videoPath, {
      timeoutMs: fetchTimeoutMs,
    });
  };

  if (!videoUploaded) {
    await fetchServerSideVideo();
    return;
  }

  const stat = await fs.stat(videoPath);
  if (stat.size === 0) {
    await fetchServerSideVideo();
  }
}
