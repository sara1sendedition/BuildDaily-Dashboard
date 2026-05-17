import { NextResponse } from "next/server";
import { denyIfNotDaemonAuthorized } from "@/lib/schedule/daemon-auth";
import type { DaemonScheduleEntry } from "@/lib/schedule/daemon-schema";
import { upsertDaemonEntry } from "@/lib/schedule/daemon-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const deny = denyIfNotDaemonAuthorized(request);
  if (deny) return deny;

  let body: { entry?: DaemonScheduleEntry };
  try {
    body = (await request.json()) as { entry?: DaemonScheduleEntry };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const entry = body.entry;
  if (!entry || typeof entry.id !== "string") {
    return NextResponse.json({ error: "entry with id is required." }, { status: 400 });
  }

  await upsertDaemonEntry(entry);
  return NextResponse.json({ ok: true });
}
