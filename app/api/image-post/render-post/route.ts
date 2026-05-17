import { NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { parseVisualReferenceProfileJson } from "@/lib/visual-reference-for-prompt";
import { parseFrameColorAdjustJson } from "@/lib/frame-color-adjust";
import { renderImagePostFromVideoFrame } from "@/lib/pipeline-image-post";
import { streamVideoFieldToDisk } from "@/lib/stream-multipart-video";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const workDir = path.join(tmpdir(), `v2i-rerender-up-${randomUUID()}`);
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
  let fields: Record<string, string>;

  try {
    const result = await streamVideoFieldToDisk(
      request,
      workDir,
      videoBasename
    );
    videoPath = result.videoPath;
    fields = result.fields;
  } catch (e) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    const message =
      e instanceof Error ? e.message : "Invalid or incomplete upload";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const rawTime = String(fields.frameTimeSec ?? "").trim();
    const frameTimeSec = parseFloat(rawTime);
    if (!Number.isFinite(frameTimeSec) || frameTimeSec < 0) {
      return NextResponse.json(
        { error: "frameTimeSec must be a non-negative number" },
        { status: 400 }
      );
    }
    const hook = String(fields.hook ?? "");
    const microCta = String(fields.microCta ?? "");
    const visualReferenceImage = parseVisualReferenceProfileJson(
      fields.visualReferenceImage
    );

    const frameColorAdjust = parseFrameColorAdjustJson(
      fields.frameColorAdjust
    );

    const pngBuffer = await renderImagePostFromVideoFrame({
      videoPath,
      frameTimeSec,
      hook,
      microCta,
      visualReferenceImage,
      frameColorAdjust: frameColorAdjust ?? null,
    });

    return NextResponse.json({
      hook,
      microCta,
      imageBase64: pngBuffer.toString("base64"),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
