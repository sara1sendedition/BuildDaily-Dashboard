import { NextResponse } from "next/server";
import { addChunkSlide } from "@/lib/meta/publish-chunked-session";
import { getMaxPublishBodyBytes } from "@/lib/meta/publish-limits";
import { getMetaEnv } from "@/lib/meta/publish";

export const runtime = "nodejs";

/** Upload one slide PNG for a session created via POST .../publish/init */
export async function POST(request: Request) {
  if (!getMetaEnv()) {
    return NextResponse.json(
      {
        error:
          "Instagram and Facebook are not connected. Open Settings to connect them.",
      },
      { status: 503 }
    );
  }

  const maxBytes = getMaxPublishBodyBytes();
  const cl = request.headers.get("content-length");
  if (cl) {
    const n = parseInt(cl, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      return NextResponse.json(
        {
          error: `This slide upload exceeds the per-request limit (~${Math.round((maxBytes / (1024 * 1024)) * 10) / 10}MB). Compress the slide or raise META_PUBLISH_MAX_BODY_BYTES.`,
        },
        { status: 413 }
      );
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    console.error("[meta/publish/part] formData", e);
    return NextResponse.json(
      { error: "Could not read multipart body." },
      { status: 400 }
    );
  }

  const sessionId = String(form.get("sessionId") ?? "").trim();
  const indexRaw = form.get("index");
  const index =
    typeof indexRaw === "string"
      ? parseInt(indexRaw, 10)
      : typeof indexRaw === "number"
        ? indexRaw
        : NaN;

  const file = form.get("slide");
  if (!sessionId || !Number.isInteger(index) || !(file instanceof Blob)) {
    return NextResponse.json(
      { error: "Missing sessionId, index, or slide file." },
      { status: 400 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty slide file." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const r = addChunkSlide(sessionId, index, buf);
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    received: r.received,
    total: r.total,
  });
}
