import { NextResponse } from "next/server";
import { getMetaEnv } from "@/lib/meta/publish";
import { verifyMetaGraphConnection } from "@/lib/meta/verify-graph";

export const runtime = "nodejs";

/**
 * GET — live check against Graph API (read-only). Does not publish or upload media.
 */
export async function GET() {
  const env = getMetaEnv();
  if (!env) {
    return NextResponse.json({
      ok: false,
      message:
        "Instagram and Facebook are not connected. Open Settings to connect them.",
    } satisfies { ok: false; message: string });
  }
  const result = await verifyMetaGraphConnection(env);
  return NextResponse.json(result);
}
