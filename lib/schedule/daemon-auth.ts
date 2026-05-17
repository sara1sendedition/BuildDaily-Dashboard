import { NextResponse } from "next/server";

export function getDaemonSecret(): string | null {
  const s = process.env.SCHEDULE_DAEMON_SECRET?.trim();
  return s && s.length > 0 ? s : null;
}

/** Returns null if authorized, otherwise a NextResponse to return. */
export function denyIfNotDaemonAuthorized(request: Request): NextResponse | null {
  const secret = getDaemonSecret();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "Set SCHEDULE_DAEMON_SECRET in .env.local (same value as NEXT_PUBLIC_SCHEDULE_DAEMON_SECRET for browser sync).",
      },
      { status: 503 }
    );
  }
  const h = request.headers.get("authorization")?.trim() ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const token = m ? m[1]!.trim() : "";
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
