import { NextResponse } from "next/server";
import { denyIfNotDaemonAuthorized } from "@/lib/schedule/daemon-auth";
import { deleteDaemonEntry } from "@/lib/schedule/daemon-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const deny = denyIfNotDaemonAuthorized(request);
  if (deny) return deny;

  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  await deleteDaemonEntry(id);
  return NextResponse.json({ ok: true });
}
