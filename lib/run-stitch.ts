/**
 * Client-side per-row stitch driver: upload → poll → download → File.
 *
 * Mirrors the architecture of ``lib/run-video-to-short.ts`` (single-clip
 * pipeline) but for the standalone stitch endpoint (`/api/stitch-only`,
 * which after the May 2026 rewrite is async-job based).
 *
 * Resilience model:
 *  - Caller generates a stable ``correlationId`` BEFORE this function runs
 *    and persists it (via ``lib/stitch-batch-state.ts``). If the upload
 *    response is lost mid-flight (lid close, mobile suspend), the caller
 *    can recover the server-side jobId via
 *    GET /api/video-to-short/jobs/by-correlation-id/{cid}.
 *  - This function always sends ``client_correlation_id`` in the multipart
 *    body so the server's lookup index gets populated.
 *  - Once the server returns a jobId, polling and downloading work the
 *    same regardless of how many times the client tab reloads.
 */

import { clientApiPath } from "@/lib/client-api-path";
import { fetchJobPollState } from "@/lib/run-video-to-short";

const POLL_MS = 1500;
const MAX_WAIT_MS = 30 * 60 * 1000; // 30 min ceiling per row.

async function mintStitchUploadToken(): Promise<{ token: string; url: string }> {
  const res = await fetch(clientApiPath("/api/stitch/upload-token"), {
    method: "POST",
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(`Could not get upload token: ${detail}`);
  }
  return (await res.json()) as { token: string; url: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type StitchUploadResult = {
  jobId: string;
  status: string;
};

/**
 * POST the clips to the stitch backend and return the assigned jobId.
 * Sends ``client_correlation_id`` so the caller can recover the jobId
 * after a lost response stream.
 */
export async function uploadStitchRow(
  clips: File[],
  correlationId: string
): Promise<StitchUploadResult> {
  if (clips.length === 0) {
    throw new Error("No clips to stitch.");
  }

  const fd = new FormData();
  for (const c of clips) {
    fd.append("files", c, c.name);
  }
  fd.append("client_correlation_id", correlationId);

  // Mint per-call: a multi-row batch can outlive a single 30-min token, and
  // minting is cheap (single HMAC).
  const { token, url } = await mintStitchUploadToken();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
  } catch (e) {
    // Network blip — caller should attempt correlation-id recovery before
    // surfacing this as a hard failure (the bytes may have actually landed).
    throw new Error(
      `Could not reach the stitch server. ${
        e instanceof Error ? e.message : ""
      }`.trim()
    );
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      detail =
        (typeof body?.detail === "string" && body.detail.trim()) ||
        (typeof body?.error === "string" && body.error.trim()) ||
        detail;
    } catch {
      try {
        const text = await res.text();
        if (text) detail = text;
      } catch {
        /* ignore */
      }
    }
    throw new Error(`Stitch upload rejected: ${detail}`);
  }

  let body: { id?: string; status?: string };
  try {
    body = (await res.json()) as { id?: string; status?: string };
  } catch {
    throw new Error("Stitch upload returned a malformed response.");
  }

  if (typeof body?.id !== "string" || !body.id.trim()) {
    throw new Error("Stitch upload response missing job id.");
  }

  return {
    jobId: body.id.trim(),
    status: typeof body.status === "string" ? body.status : "pending",
  };
}

/**
 * Recover the server-side jobId after a lost upload response. Returns null
 * if no job has been registered for this correlationId yet (e.g. the upload
 * never actually reached the server).
 */
export async function recoverStitchJobIdByCorrelationId(
  correlationId: string
): Promise<string | null> {
  const res = await fetch(
    clientApiPath(
      `/api/video-to-short/jobs/by-correlation-id/${encodeURIComponent(correlationId)}`
    ),
    { cache: "no-store" }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Correlation lookup failed (HTTP ${res.status}).`);
  }
  let body: { id?: string };
  try {
    body = (await res.json()) as { id?: string };
  } catch {
    throw new Error("Correlation lookup returned malformed JSON.");
  }
  return typeof body?.id === "string" && body.id.trim() ? body.id.trim() : null;
}

/**
 * Poll the stitch job until it reaches a terminal state. Re-uses
 * ``fetchJobPollState`` from ``run-video-to-short`` since the status shape
 * is the same.
 */
export async function pollStitchJobUntilDone(
  jobId: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(
        "Stitch timed out after 30 minutes. Check the backend logs."
      );
    }
    const state = await fetchJobPollState(jobId, onProgress);
    if (state.status === "failed") {
      throw new Error(
        typeof state.error === "string" && state.error.trim()
          ? state.error.trim()
          : "Stitch job failed."
      );
    }
    if (state.status === "completed") return;
    await sleep(POLL_MS);
  }
}

/**
 * Download the stitched MP4 for a completed job. Returns the raw Blob —
 * caller is responsible for wrapping it into a File with the right name.
 */
export async function downloadStitchOutput(jobId: string): Promise<Blob> {
  const bust = `_=${Date.now()}`;
  const res = await fetch(
    clientApiPath(
      `/api/video-to-short/jobs/${encodeURIComponent(jobId)}/download?${bust}`
    ),
    { cache: "no-store" }
  );
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      detail = (await res.text()) || detail;
    } catch {
      /* ignore */
    }
    throw new Error(`Stitch download failed: ${detail}`);
  }
  const blob = await res.blob();
  if (!blob || blob.size === 0) {
    throw new Error("Stitch download returned an empty file.");
  }
  return blob;
}

/**
 * High-level helper: upload a row, poll until done, download the result.
 * Caller persists ``correlationId`` to localStorage BEFORE invoking this
 * so the row is recoverable across reload.
 */
export async function runStitchRow(
  clips: File[],
  correlationId: string,
  onProgress?: (msg: string) => void,
  onJobId?: (jobId: string) => void
): Promise<{ jobId: string; blob: Blob }> {
  onProgress?.("Uploading clips…");
  let jobId: string;
  try {
    const upload = await uploadStitchRow(clips, correlationId);
    jobId = upload.jobId;
  } catch (e) {
    // Upload-response lost? Try recovery before surfacing the error.
    const recovered = await recoverStitchJobIdByCorrelationId(
      correlationId
    ).catch(() => null);
    if (!recovered) throw e;
    jobId = recovered;
  }
  onJobId?.(jobId);
  onProgress?.("Stitching on the server…");
  await pollStitchJobUntilDone(jobId, onProgress);
  onProgress?.("Downloading stitched video…");
  const blob = await downloadStitchOutput(jobId);
  return { jobId, blob };
}
