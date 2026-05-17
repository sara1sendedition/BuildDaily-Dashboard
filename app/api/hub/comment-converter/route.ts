import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { commentInboxApiUrl } from "@/lib/hub/env";

export const runtime = "nodejs";

export async function GET() {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = (
    sessionClaims?.publicMetadata as { commentInboxWorkspaceId?: string } | undefined
  )?.commentInboxWorkspaceId?.trim();

  const secret = process.env.HUB_COMMENT_INBOX_SECRET?.trim();
  const apiBase = commentInboxApiUrl();

  if (!workspaceId || !secret || !apiBase) {
    return NextResponse.json({
      connected: false,
      stats: null,
    });
  }

  try {
    const url = new URL(`${apiBase}/api/inbox/dashboard`);
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${secret}`,
        "X-Hub-Workspace-Id": workspaceId,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({
        connected: false,
        stats: null,
        error: `Inbox ${res.status}`,
      });
    }
    const data = (await res.json()) as {
      commentsPulled?: number;
      replies?: number;
      directedSomewhere?: number;
    };
    return NextResponse.json({
      connected: true,
      stats: {
        commentsPulled: Number(data.commentsPulled) || 0,
        replies: Number(data.replies) || 0,
        directedSomewhere: Number(data.directedSomewhere) || 0,
        connected: true,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return NextResponse.json({
      connected: false,
      stats: null,
      error: msg,
    });
  }
}
