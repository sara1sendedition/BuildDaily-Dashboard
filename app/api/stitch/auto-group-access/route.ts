import { NextResponse } from "next/server";
import { ownerAutoGroupAllowed } from "@/lib/auth/owner-access";

export const runtime = "nodejs";

/** Whether the signed-in user may use internal Stitch auto-group. */
export async function GET() {
  const allowed = await ownerAutoGroupAllowed();
  return NextResponse.json({ allowed });
}
