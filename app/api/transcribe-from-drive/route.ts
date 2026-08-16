import { NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { ownerApiGuard } from "@/lib/auth/owner-access";
import { effectiveDurationSec } from "@/lib/slide-time";
import {
  downloadDriveInboxVideoToPath,
  isValidDriveFileId,
} from "@/lib/server/drive-inbox-fetch";
import { transcribeVideoFile } from "@/lib/transcribe-video-file";
import { transcriptPlainText } from "@/lib/stitch-group-plan";
import { isVideoToShortIntegrationEnabled } from "@/lib/video-to-short-config";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Whisper one Google Drive inbox video on the server (no browser download).
 * Used by Stitch auto-group before deciding stitch vs solo.
 */
export async function POST(request: Request) {
  const denied = await ownerApiGuard();
  if (denied) return denied;

  if (!isVideoToShortIntegrationEnabled()) {
    return NextResponse.json(
      { error: "Video to Short integration is disabled." },
      { status: 503 }
    );
  }

  const key = process.env.OPENAI_API_KEY ?? "";
  const useStub =
    process.env.USE_STUB_LLM === "true" || process.env.USE_STUB_LLM === "1";
  if (!key && !useStub) {
    return NextResponse.json(
      {
        error:
          "Missing OPENAI_API_KEY. Set it in .env.local or enable USE_STUB_LLM=true for UI testing.",
      },
      { status: 400 }
    );
  }

  let body: { fileId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const fileId = typeof body.fileId === "string" ? body.fileId.trim() : "";
  if (!fileId || !isValidDriveFileId(fileId)) {
    return NextResponse.json({ error: "Invalid Drive file id." }, { status: 400 });
  }

  const workDir = path.join(tmpdir(), `v2t-drive-${randomUUID()}`);
  try {
    await fs.mkdir(workDir, { recursive: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not create a temp folder for the Drive download.",
      },
      { status: 500 }
    );
  }

  const videoPath = path.join(workDir, "input.mp4");
  try {
    await downloadDriveInboxVideoToPath(fileId, videoPath);
    const { transcript, durationProbed } = await transcribeVideoFile(videoPath, {
      openaiApiKey: key || "stub",
      useStubLlm: useStub,
    });
    const durationSec = effectiveDurationSec(durationProbed, transcript);
    return NextResponse.json({
      fileId,
      transcript,
      durationSec,
      text: transcriptPlainText(transcript),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Transcription failed";
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
