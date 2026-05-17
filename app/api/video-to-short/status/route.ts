import { NextResponse } from "next/server";
import {
  getVideoToShortApiBaseUrl,
  isVideoToShortIntegrationEnabled,
} from "@/lib/video-to-short-config";

export const runtime = "nodejs";

function clientSkipsVideoToShort(): boolean {
  const v = process.env.NEXT_PUBLIC_SKIP_VIDEO_TO_SHORT?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** FastAPI exposes this when the Short backend is up. */
async function probeShortBackendOpenApi(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/openapi.json`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * For the studio UI: whether Short integration is configured and the backend looks reachable.
 */
export async function GET() {
  const integrationEnabled = isVideoToShortIntegrationEnabled();
  const skipClient = clientSkipsVideoToShort();
  const apiBase = getVideoToShortApiBaseUrl();

  let backendReachable: boolean | null = null;
  if (integrationEnabled && !skipClient) {
    backendReachable = await probeShortBackendOpenApi(apiBase);
  }

  return NextResponse.json({
    integrationEnabled,
    clientSkipsShort: skipClient,
    apiBase,
    backendReachable,
  });
}
