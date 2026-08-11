import { createHash } from "crypto";
import { createReadStream, existsSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isAllowedSourceVideoUrl } from "@/lib/allowed-source-video-url";
import { remuxMp4Faststart } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const maxDuration = 180;

const CACHE_DIR = path.join(tmpdir(), "builddaily-mp4-faststart");

function cachePathForUrl(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 40);
  return path.join(CACHE_DIR, `${hash}.mp4`);
}

/**
 * GET /api/media/mp4-faststart?url=…
 *
 * Remuxes an allowed Bunny MP4 with `+faststart` and streams it same-origin.
 * iOS Safari cannot progressively preview many CDN reels when moov is at the
 * end of the file — this proxy fixes that for existing assets.
 */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const raw = new URL(request.url).searchParams.get("url")?.trim() ?? "";
  if (!raw || !isAllowedSourceVideoUrl(raw)) {
    return NextResponse.json(
      { error: "url must be an allowed HTTPS Bunny media URL." },
      { status: 400 },
    );
  }

  const outPath = cachePathForUrl(raw);
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    let ready = existsSync(outPath);
    if (ready) {
      const st = await fs.stat(outPath);
      if (st.size === 0) ready = false;
    }
    if (!ready) {
      const inPath = `${outPath}.src`;
      const tmpOut = `${outPath}.tmp`;
      try {
        const res = await fetch(raw, { cache: "no-store" });
        if (!res.ok) {
          return NextResponse.json(
            { error: `Could not fetch source video (${res.status}).` },
            { status: 502 },
          );
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) {
          return NextResponse.json(
            { error: "Source video was empty." },
            { status: 502 },
          );
        }
        await fs.writeFile(inPath, buf);
        await remuxMp4Faststart(inPath, tmpOut);
        await fs.rename(tmpOut, outPath);
      } finally {
        await fs.unlink(inPath).catch(() => undefined);
        await fs.unlink(tmpOut).catch(() => undefined);
      }
    }

    const st = await fs.stat(outPath);
    const size = st.size;
    const range = request.headers.get("range");
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Number(m[2]) : size - 1;
        if (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          start >= 0 &&
          end >= start &&
          start < size
        ) {
          const safeEnd = Math.min(end, size - 1);
          const chunkSize = safeEnd - start + 1;
          const stream = createReadStream(outPath, {
            start,
            end: safeEnd,
          });
          return new NextResponse(stream as unknown as BodyInit, {
            status: 206,
            headers: {
              "Content-Type": "video/mp4",
              "Content-Length": String(chunkSize),
              "Content-Range": `bytes ${start}-${safeEnd}/${size}`,
              "Accept-Ranges": "bytes",
              "Cache-Control": "private, max-age=3600",
            },
          });
        }
      }
    }

    const stream = createReadStream(outPath);
    return new NextResponse(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not prepare mobile-friendly MP4 preview.",
      },
      { status: 502 },
    );
  }
}
