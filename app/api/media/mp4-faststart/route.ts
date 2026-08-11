import { createHash, randomUUID } from "crypto";
import { existsSync } from "fs";
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

/** One remux per source URL per process — avoids corrupt overlapping writes. */
const inflightRemux = new Map<string, Promise<void>>();

function cachePathForUrl(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 40);
  return path.join(CACHE_DIR, `${hash}.mp4`);
}

function videoHeaders(extra: Record<string, string> = {}): Headers {
  // `no-transform` is required: edge proxies (Coolify/nginx) otherwise gzip the
  // MP4 body on 200 responses, which breaks <video> playback (black frame, play
  // does nothing). Same pattern as /api/video-to-short/jobs/.../download.
  return new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600, no-transform",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
}

async function ensureFaststartFile(raw: string, outPath: string): Promise<void> {
  let ready = existsSync(outPath);
  if (ready) {
    const st = await fs.stat(outPath);
    if (st.size === 0) ready = false;
  }
  if (ready) return;

  let pending = inflightRemux.get(outPath);
  if (!pending) {
    pending = (async () => {
      // Re-check after awaiting the lock winner.
      if (existsSync(outPath)) {
        const st = await fs.stat(outPath);
        if (st.size > 0) return;
      }
      const id = randomUUID();
      const inPath = `${outPath}.${id}.src`;
      const tmpOut = `${outPath}.${id}.tmp`;
      try {
        const res = await fetch(raw, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Could not fetch source video (${res.status}).`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) {
          throw new Error("Source video was empty.");
        }
        await fs.writeFile(inPath, buf);
        await remuxMp4Faststart(inPath, tmpOut);
        const st = await fs.stat(tmpOut);
        if (st.size === 0) {
          throw new Error("Faststart remux produced an empty file.");
        }
        // Atomic replace when possible; if another worker already published,
        // keep the existing good file.
        if (existsSync(outPath)) {
          const existing = await fs.stat(outPath);
          if (existing.size > 0) return;
        }
        await fs.rename(tmpOut, outPath);
      } finally {
        await fs.unlink(inPath).catch(() => undefined);
        await fs.unlink(tmpOut).catch(() => undefined);
      }
    })().finally(() => {
      inflightRemux.delete(outPath);
    });
    inflightRemux.set(outPath, pending);
  }
  await pending;
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
    await ensureFaststartFile(raw, outPath);

    // Buffer-based Range responses (not Node streams) so iOS Safari seek/play
    // works reliably through Next.js.
    const file = await fs.readFile(outPath);
    const size = file.byteLength;
    if (size === 0) {
      return NextResponse.json(
        { error: "Prepared preview file was empty." },
        { status: 502 },
      );
    }
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
          const chunk = file.subarray(start, safeEnd + 1);
          return new NextResponse(chunk, {
            status: 206,
            headers: videoHeaders({
              "Content-Length": String(chunk.byteLength),
              "Content-Range": `bytes ${start}-${safeEnd}/${size}`,
            }),
          });
        }
      }
    }

    return new NextResponse(file, {
      status: 200,
      headers: videoHeaders({
        "Content-Length": String(size),
      }),
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
