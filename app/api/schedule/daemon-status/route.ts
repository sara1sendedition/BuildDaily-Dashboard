import { NextResponse } from "next/server";
import { denyIfNotDaemonAuthorized } from "@/lib/schedule/daemon-auth";
import { readDaemonSchedule } from "@/lib/schedule/daemon-store";

export const runtime = "nodejs";

/**
 * Returns publish state per scheduled id (no slide payloads).
 * Same Bearer auth as other daemon routes.
 */
export async function GET(request: Request) {
  const deny = denyIfNotDaemonAuthorized(request);
  if (deny) return deny;

  const list = await readDaemonSchedule();
  const entries = list.map((e) => ({
    id: e.id,
    publishAtUnix: e.publishAtUnix,
    daemonPublishedAt: e.daemonPublishedAt,
    daemonLastError: e.daemonLastError,
  }));

  return NextResponse.json({ entries });
}
