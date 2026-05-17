import { NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { streamVideoFieldToDisk } from "@/lib/stream-multipart-video";
import { effectiveDurationSec } from "@/lib/slide-time";
import { transcribeVideoFile } from "@/lib/transcribe-video-file";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
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

  const workDir = path.join(tmpdir(), `v2t-up-${randomUUID()}`);
  try {
    await fs.mkdir(workDir, { recursive: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not create a temp folder for the upload.",
      },
      { status: 500 }
    );
  }

  const videoBasename = `input-${randomUUID()}.mp4`;
  let videoPath: string;
  try {
    const result = await streamVideoFieldToDisk(
      request,
      workDir,
      videoBasename
    );
    videoPath = result.videoPath;
  } catch (e) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    const message =
      e instanceof Error ? e.message : "Invalid or incomplete upload";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const { transcript, durationProbed } = await transcribeVideoFile(
      videoPath,
      {
        openaiApiKey: key || "stub",
        useStubLlm: useStub,
      }
    );
    const durationSec = effectiveDurationSec(durationProbed, transcript);
    return NextResponse.json({ transcript, durationSec });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Transcription failed";
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
