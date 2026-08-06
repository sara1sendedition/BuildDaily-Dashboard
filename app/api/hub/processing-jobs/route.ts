import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";

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
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
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
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.search ? url.search : "";
  return forward("GET", `/api/v1/processing-jobs${qs}`);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  return forward("POST", "/api/v1/processing-jobs", body);
}
