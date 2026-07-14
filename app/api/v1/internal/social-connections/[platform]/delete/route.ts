import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyIfNotInternalAuthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";

/**
 * POST /api/v1/internal/social-connections/[platform]/delete
 *
 * Server-to-server (shared-secret) endpoint that removes a user's connection
 * for `[platform]`. Used by the Multiplier's "Disconnect" action so the user
 * (or a reviewer re-recording the flow) can revoke on the app side with one
 * click.
 *
 * Auth: `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>`.
 * Body: { userId: string }
 */
export async function POST(
  request: Request,
  ctx:
    | { params: Promise<{ platform: string }> }
    | { params: { platform: string } },
) {
  const deny = denyIfNotInternalAuthorized(request);
  if (deny) return deny;

  const rawParams = (ctx as { params: unknown }).params;
  const params =
    typeof (rawParams as Promise<unknown>)?.then === "function"
      ? await (rawParams as Promise<{ platform: string }>)
      : (rawParams as { platform: string });
  const platform = params.platform;

  let body: { userId?: string };
  try {
    const text = await request.text();
    body = text ? (JSON.parse(text) as typeof body) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  const result = await prisma.socialConnection.deleteMany({
    where: { userId, platform },
  });

  return NextResponse.json({ deleted: result.count });
}
