import type { DriveInboxFile } from "@/app/components/DriveInboxPanel";
import { clientApiPath } from "@/lib/client-api-path";
import {
  MAX_STITCH_AUTO_GROUP_FILES,
  type StitchGroup,
  type StitchGroupClipInput,
} from "@/lib/stitch-group-plan";

const TRANSCRIBE_CONCURRENCY = 2;

export type AutoGroupDriveResult = {
  groups: StitchGroup[];
  filesById: Map<string, DriveInboxFile>;
  transcribeErrors: Array<{ fileId: string; name: string; error: string }>;
};

async function transcribeOne(
  file: DriveInboxFile
): Promise<StitchGroupClipInput> {
  const res = await fetch(clientApiPath("/api/transcribe-from-drive"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId: file.id }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    text?: string;
    durationSec?: number;
  };
  if (!res.ok) {
    throw new Error(body.error?.trim() || `HTTP ${res.status}`);
  }
  return {
    fileId: file.id,
    name: file.name,
    modifiedAt: file.modified_at,
    durationSec:
      typeof body.durationSec === "number" && Number.isFinite(body.durationSec)
        ? body.durationSec
        : null,
    text: typeof body.text === "string" ? body.text : "",
  };
}

/**
 * Transcribe selected Drive inbox videos (server-side), then LLM-group
 * which ones should be stitched vs processed individually.
 */
export async function autoGroupDriveClips(
  files: DriveInboxFile[],
  onProgress: (message: string) => void
): Promise<AutoGroupDriveResult> {
  if (files.length < 1) {
    throw new Error("Select at least one Drive video.");
  }
  if (files.length > MAX_STITCH_AUTO_GROUP_FILES) {
    throw new Error(
      `Auto-group supports up to ${MAX_STITCH_AUTO_GROUP_FILES} videos at a time.`
    );
  }

  const filesById = new Map(files.map((f) => [f.id, f]));
  const clips: StitchGroupClipInput[] = new Array(files.length);
  const transcribeErrors: AutoGroupDriveResult["transcribeErrors"] = [];
  let done = 0;
  let cursor = 0;

  onProgress(`Transcribing 0/${files.length}…`);

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = cursor++;
      if (idx >= files.length) return;
      const file = files[idx]!;
      onProgress(
        `Transcribing ${Math.min(done + 1, files.length)}/${files.length}: ${file.name}`
      );
      try {
        clips[idx] = await transcribeOne(file);
      } catch (e) {
        const error = e instanceof Error ? e.message : "Transcription failed";
        transcribeErrors.push({
          fileId: file.id,
          name: file.name,
          error,
        });
        clips[idx] = {
          fileId: file.id,
          name: file.name,
          modifiedAt: file.modified_at,
          durationSec: null,
          text: "",
        };
      } finally {
        done += 1;
        onProgress(`Transcribed ${done}/${files.length}…`);
      }
    }
  };

  const pool = Math.min(TRANSCRIBE_CONCURRENCY, files.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));

  onProgress("Grouping stitch vs solo from transcripts…");

  const res = await fetch(clientApiPath("/api/stitch/group-from-transcripts"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clips }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    groups?: StitchGroup[];
  };
  if (!res.ok) {
    throw new Error(body.error?.trim() || `Grouping failed (HTTP ${res.status})`);
  }
  if (!Array.isArray(body.groups) || body.groups.length === 0) {
    throw new Error("Grouping returned no videos.");
  }

  return { groups: body.groups, filesById, transcribeErrors };
}
