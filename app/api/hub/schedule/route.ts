import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";

/**
 * Multiplier → Hub proxy for /api/v1/schedule.
 *
 * The Multiplier's calendar (ScheduledCarouselPost in browser localStorage) is
 * being migrated to be backed by the Hub's `ScheduleEntry` Postgres rows.
 * Reads and writes go through this same-origin proxy so:
 *   - The browser stays on app.builddaily.app (no CORS)
 *   - The Hub continues to enforce Clerk auth (we forward a fresh Clerk JWT)
 *
 * Schema translation between the Multiplier's ScheduledCarouselPost shape and
 * the Hub's ScheduleEntry shape lives in `lib/schedule/hub-translator.ts`.
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

async function forward(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<NextResponse> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) {
    return NextResponse.json(
      { error: "Not signed in." },
      { status: 401 },
    );
  }
  let hubUrl: string;
  try {
    hubUrl = `${getHubBase()}${path}`;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Hub URL misconfigured." },
      { status: 503 },
    );
  }
  let res: Response;
  try {
    res = await fetch(hubUrl, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body == null ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? `Hub fetch failed: ${e.message}`
            : "Hub fetch failed.",
      },
      { status: 502 },
    );
  }
  const text = await res.text();
  // Pass through status + body verbatim. Force JSON content-type because the
  // Hub returns either application/json (success) or application/problem+json
  // (RFC 7807); both are JSON-parsable on the client.
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

/** GET /api/hub/schedule → GET /api/v1/schedule on the Hub. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const unposted = url.searchParams.get("unposted") === "1";
  const qs = unposted ? "?unposted=1" : "";
  return forward("GET", `/api/v1/schedule${qs}`);
}

/** POST /api/hub/schedule → POST /api/v1/schedule (upsert). */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  return forward("POST", "/api/v1/schedule", body);
}
