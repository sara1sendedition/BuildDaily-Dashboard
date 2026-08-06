import { fetchUrlToFile } from "@/lib/fetch-url-to-file";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

/**
 * Server-side fetch of a Google Drive inbox video via the Video to Short
 * backend (which holds the Drive service account). Both apps run on the same
 * Coolify host, so this transfer never touches the user's browser — the whole
 * point. Replaces the old flow where "Add" streamed the full video through
 * the Next proxy to the browser at ~0.12 MB/s and large files died on any
 * tab interruption.
 */

const FILE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** Generous cap: backend Drive pull + same-host stream for ~500 MB files. */
const DRIVE_FETCH_TIMEOUT_MS = 540_000;

export function isValidDriveFileId(id: string): boolean {
  return FILE_ID_RE.test(id);
}

/** Download one Drive inbox video to a local path. Throws on any failure. */
export async function downloadDriveInboxVideoToPath(
  fileId: string,
  destPath: string
): Promise<void> {
  if (!isVideoToShortIntegrationEnabled()) {
    throw new Error("Video to Short integration is disabled.");
  }
  const id = fileId.trim();
  if (!isValidDriveFileId(id)) {
    throw new Error("Invalid Drive file id.");
  }
  const base = getVideoToShortApiBaseUrl();
  await fetchUrlToFile(
    `${base}/api/drive/inbox/${encodeURIComponent(id)}/download`,
    destPath,
    { timeoutMs: DRIVE_FETCH_TIMEOUT_MS }
  );
}

const JOB_ID_RE = /^[a-zA-Z0-9-]+$/;
const SOURCE_WAIT_DEADLINE_MS = 15 * 60_000;
const SOURCE_POLL_INTERVAL_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Download a job's already-ingested source video (`/api/jobs/{id}/source-video`).
 * The from-drive job downloads the file from Drive ONCE in the backend; every
 * other consumer (transcribe, carousel, image post, re-render) reuses that
 * copy instead of pulling from Drive again. The job's Drive download runs in
 * the background, so poll the job until it leaves "pending" (download done,
 * pipeline started) before fetching — fetching earlier risks a partial file.
 */
async function downloadJobSourceVideoToPath(
  jobId: string,
  destPath: string
): Promise<void> {
  const id = jobId.trim();
  if (!JOB_ID_RE.test(id)) {
    throw new Error("Invalid job id.");
  }
  const base = getVideoToShortApiBaseUrl();
  const deadline = Date.now() + SOURCE_WAIT_DEADLINE_MS;
  for (;;) {
    const res = await fetch(
      `${base}/api/jobs/${encodeURIComponent(id)}`,
      { cache: "no-store" }
    );
    if (res.status === 404) {
      throw new Error("Source job not found.");
    }
    if (res.ok) {
      const j = (await res.json()) as { status?: string; error?: unknown };
      if (j.status === "failed") {
        throw new Error(
          typeof j.error === "string" && j.error
            ? j.error
            : "Drive ingest failed on the server."
        );
      }
      if (j.status && j.status !== "pending") break;
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the server-side Drive download.");
    }
    await sleep(SOURCE_POLL_INTERVAL_MS);
  }
  await fetchUrlToFile(
    `${base}/api/jobs/${encodeURIComponent(id)}/source-video`,
    destPath,
    { timeoutMs: DRIVE_FETCH_TIMEOUT_MS }
  );
}

/**
 * Resolve a drive-ingested video to a local path: prefer the source job's
 * already-downloaded copy, fall back to a direct Drive inbox pull.
 */
export async function downloadDriveSourceToPath(
  source: { sourceJobId?: string; driveFileId?: string },
  destPath: string
): Promise<void> {
  const jobId = (source.sourceJobId ?? "").trim();
  const driveId = (source.driveFileId ?? "").trim();
  if (jobId) {
    try {
      await downloadJobSourceVideoToPath(jobId, destPath);
      return;
    } catch (e) {
      // Job pruned / source removed — fall back to Drive when possible.
      if (!driveId) throw e;
    }
  }
  if (!driveId) {
    throw new Error("Missing video file");
  }
  await downloadDriveInboxVideoToPath(driveId, destPath);
}
