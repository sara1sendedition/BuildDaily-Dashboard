import { createHash, randomUUID } from "crypto";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isAllowedSourceVideoUrl } from "@/lib/allowed-source-video-url";
import { remuxMp4Faststart } from "@/lib/ffmpeg";
import {
  signMp4PreviewAccess,
  verifyMp4PreviewAccess,
} from "@/lib/media/mp4-preview-sign";

export const runtime = "nodejs";
export const maxDuration = 180;

// v3: AAC remux + signed cookie-less playback for iOS.
const CACHE_DIR = path.join(tmpdir(), "builddaily-mp4-faststart-v3");

/** One remux per source URL per process — avoids corrupt overlapping writes. */
const inflightRemux = new Map<string, Promise<void>>();

function cachePathForUrl(url: string): string {
  const hash = createHash("sha256")
    .update(`v3:${url}`)
    .digest("hex")
    .slice(0, 40);
  return path.join(CACHE_DIR, `${hash}.mp4`);
}

function videoHeaders(extra: Record<string, string> = {}): Headers {
  // `no-transform` is required: edge proxies (Coolify/nginx) otherwise gzip the
  // MP4 body on 200 responses, which breaks <video> playback.
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
      if (existsSync(outPath)) {
        const st = await fs.stat(outPath);
        if (st.size > 0) return;
      }
      const id = randomUUID();
      const inPath = `${outPath}.${id}.src.mp4`;
      const tmpOut = `${outPath}.${id}.out.mp4`;
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

function sanitizeFfmpegError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "Could not prepare mobile-friendly MP4 preview.";
  if (/maxBuffer/i.test(trimmed)) {
    return "Preview remux timed out or produced too much log output. Try again.";
  }
  if (
    /suitable output format/i.test(trimmed) ||
    /Error opening output/i.test(trimmed)
  ) {
    return "Could not remux this reel for mobile preview.";
  }
  if (/ENOENT|not found|FFMPEG_INSTALL|not on your PATH/i.test(trimmed)) {
    return "FFmpeg is not available on the server for mobile preview.";
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(
      (l) => !l.startsWith("--enable-") && !l.startsWith("configuration:"),
    );
  const last = lines[lines.length - 1] ?? trimmed;
  if (last.length > 180) return `${last.slice(0, 177)}…`;
  if (/libavutil|libavcodec|ffmpeg version/i.test(last) && lines.length < 3) {
    return "Could not prepare mobile-friendly MP4 preview.";
  }
  return last;
}

/**
 * GET /api/media/mp4-faststart?url=…
 *
 * Auth: Clerk session cookie OR short-lived HMAC (`uid` + `exp` + `sig`) so
 * iPhone Safari `<video src>` does not depend on cookies (and never hits a
 * Clerk HTML redirect — that surfaces as native "Load Failed").
 *
 * Query `prepare=1`: remux only, return JSON `{ ok, playUrl }` for the player
 * to warm cache before setting video.src.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const raw = requestUrl.searchParams.get("url")?.trim() ?? "";
  const prepareOnly = requestUrl.searchParams.get("prepare") === "1";
  const exp = requestUrl.searchParams.get("exp");
  const sig = requestUrl.searchParams.get("sig");
  const uid = requestUrl.searchParams.get("uid")?.trim() ?? "";

  if (!raw || !isAllowedSourceVideoUrl(raw)) {
    return NextResponse.json(
      { error: "url must be an allowed HTTPS Bunny media URL." },
      { status: 400 },
    );
  }

  let userId: string | null = null;
  if (verifyMp4PreviewAccess({ bunnyUrl: raw, userId: uid, exp, sig })) {
    userId = uid;
  } else {
    const session = await auth();
    userId = session.userId;
  }
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const outPath = cachePathForUrl(raw);
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await ensureFaststartFile(raw, outPath);

    if (prepareOnly) {
      const signed = signMp4PreviewAccess({ bunnyUrl: raw, userId });
      const playUrl = new URL(requestUrl.pathname, requestUrl.origin);
      // Preserve basePath if any — pathname already includes it when set on request.
      playUrl.searchParams.set("url", raw);
      playUrl.searchParams.set("uid", signed.userId);
      playUrl.searchParams.set("exp", String(signed.exp));
      playUrl.searchParams.set("sig", signed.sig);
      return NextResponse.json({
        ok: true,
        playUrl: `${playUrl.pathname}${playUrl.search}`,
      });
    }

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
    const rawMsg =
      e instanceof Error
        ? e.message
        : "Could not prepare mobile-friendly MP4 preview.";
    return NextResponse.json(
      { error: sanitizeFfmpegError(rawMsg) },
      { status: 502 },
    );
  }
}
