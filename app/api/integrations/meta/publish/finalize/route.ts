import { NextResponse } from "next/server";
import {
  deleteChunkSession,
  getPublishPackIfReady,
} from "@/lib/meta/publish-chunked-session";
import {
  MetaGraphError,
  formatMetaUserFacingMessage,
} from "@/lib/meta/errors";
import { getMetaEnv, publishCarouselToMeta } from "@/lib/meta/publish";

export const runtime = "nodejs";
export const maxDuration = 300;

type FinalizeBody = { sessionId?: string };

/**
 * After all /publish/part uploads, assemble slides in order and publish one carousel to Meta.
 */
export async function POST(request: Request) {
  const env = getMetaEnv();
  if (!env) {
    return NextResponse.json(
      {
        error:
          "Meta is not configured. Set META_PAGE_ACCESS_TOKEN and META_PAGE_ID in .env.local.",
      },
      { status: 503 }
    );
  }

  let body: FinalizeBody;
  try {
    body = (await request.json()) as FinalizeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  const pack = getPublishPackIfReady(sessionId);
  if (!pack) {
    return NextResponse.json(
      {
        error:
          "Session is incomplete or expired. Upload every slide with /publish/part (indices 0…n-1), then finalize within 15 minutes.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await publishCarouselToMeta({
      version: env.version,
      pageId: env.pageId,
      accessToken: env.token,
      imagePngBuffers: pack.buffers,
      caption: pack.caption,
      publishInstagram: pack.publishInstagram,
      publishFacebook: pack.publishFacebook,
      scheduledPublishTime: pack.scheduledPublishTime,
    });
    deleteChunkSession(sessionId);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof MetaGraphError) {
      return NextResponse.json(
        {
          error: formatMetaUserFacingMessage(e),
          meta: e.body,
        },
        { status: 502 }
      );
    }
    console.error("[meta/publish/finalize]", e);
    const message =
      e instanceof Error ? e.message : "Unknown error during publish.";
    return NextResponse.json(
      { error: `Server error while publishing: ${message}` },
      { status: 500 }
    );
  }
}
