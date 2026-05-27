import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDaemonSecret } from "@/lib/schedule/daemon-auth";

export type ScheduleApiAuth =
  | { mode: "daemon"; secret: string }
  | { mode: "clerk"; token: string };

function bearerToken(request: Request): string | null {
  const h = request.headers.get("authorization")?.trim() ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1]!.trim() : null;
}

/**
 * Authorize schedule automation routes:
 * - `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>` for Claude / scripts
 * - Clerk session cookie when no Bearer header (browser while signed in)
 */
export async function authorizeScheduleApi(
  request: Request,
): Promise<ScheduleApiAuth | NextResponse> {
  const bearer = bearerToken(request);
  const secret = getDaemonSecret();

  if (bearer) {
    if (!secret) {
      return NextResponse.json(
        {
          error:
            "Set SCHEDULE_DAEMON_SECRET in the server env to use Bearer auth.",
        },
        { status: 503 },
      );
    }
    if (bearer !== secret) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    return { mode: "daemon", secret };
  }

  const { getToken } = await auth();
  const token = await getToken();
  if (token) {
    return { mode: "clerk", token };
  }

  return NextResponse.json(
    {
      error:
        "Not signed in. Pass `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>` or use a Clerk session.",
    },
    { status: 401 },
  );
}
