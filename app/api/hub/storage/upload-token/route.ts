import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";

/**
 * Same-origin proxy for the Hub's `/api/v1/storage/upload-token` endpoint.
 * The Multiplier browser hits this route with a Clerk cookie session, the
 * server forwards a fresh Clerk JWT to the Hub, and the Hub mints a
 * presigned token for direct browser-to-Bunny upload.
 *
 * See `app/api/hub/schedule/route.ts` for the rationale behind the proxy
 * pattern (no CORS to configure on the Hub).
 */

function getHubBase(): string {
  const raw = process.env.HUB_API_URL?.trim();
  if (!raw) {
    throw new Error(
      "HUB_API_URL is not set. Add it to Coolify env (e.g. https://hub.builddaily.app).",
    );
  }
  return raw.replace(/\/$/, "");
}

export async function POST(req: NextRequest) {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let hubUrl: string;
  try {
    hubUrl = `${getHubBase()}/api/v1/storage/upload-token`;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Hub URL misconfigured." },
      { status: 503 },
    );
  }

  let res: Response;
  try {
    res = await fetch(hubUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? `Hub fetch failed: ${e.message}` : "Hub fetch failed.",
      },
      { status: 502 },
    );
  }

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
