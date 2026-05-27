import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";

/** Same pattern as ../route.ts, for /api/v1/schedule/[id]. */

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
  method: "GET" | "PATCH" | "DELETE",
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
          e instanceof Error ? `Hub fetch failed: ${e.message}` : "Hub fetch failed.",
      },
      { status: 502 },
    );
  }
  // 204 No Content has no body.
  if (res.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

type ParamsCtx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: ParamsCtx) {
  const { id } = await ctx.params;
  return forward("GET", `/api/v1/schedule/${encodeURIComponent(id)}`);
}

export async function PATCH(req: NextRequest, ctx: ParamsCtx) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  return forward("PATCH", `/api/v1/schedule/${encodeURIComponent(id)}`, body);
}

export async function DELETE(_req: NextRequest, ctx: ParamsCtx) {
  const { id } = await ctx.params;
  return forward("DELETE", `/api/v1/schedule/${encodeURIComponent(id)}`);
}
