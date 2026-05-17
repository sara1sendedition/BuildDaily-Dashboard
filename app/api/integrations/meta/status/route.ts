import { NextResponse } from "next/server";
import {
  formatPublishLimitSummary,
  getMaxPublishBodyBytes,
} from "@/lib/meta/publish-limits";
import { getMetaEnv } from "@/lib/meta/publish";

export const runtime = "nodejs";

/**
 * Returns whether Meta Page publishing env is configured (no secrets exposed),
 * plus effective publish body size limits for the UI.
 */
export async function GET() {
  const env = getMetaEnv();
  const maxBytes = getMaxPublishBodyBytes();
  return NextResponse.json({
    configured: env !== null,
    publishMaxBodyBytes: maxBytes,
    publishLimitSummary: formatPublishLimitSummary(maxBytes),
  });
}
