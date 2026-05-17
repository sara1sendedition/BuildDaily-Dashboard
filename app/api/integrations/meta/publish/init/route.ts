import { NextResponse } from "next/server";
import { createChunkSession } from "@/lib/meta/publish-chunked-session";
import { getMetaEnv } from "@/lib/meta/publish";
import { parseScheduledField } from "@/lib/meta/parse-scheduled-field";
import { stripEmDashes } from "@/lib/strip-em-dash";

export const runtime = "nodejs";

type InitBody = {
  slideCount?: number;
  caption?: string;
  publishInstagram?: boolean;
  publishFacebook?: boolean;
  scheduledPublishTime?: number | string;
};

/**
 * Start a multi-request carousel publish: returns sessionId for /publish/part calls.
 */
export async function POST(request: Request) {
  const env = getMetaEnv();
  if (!env) {
    return NextResponse.json(
      {
        error:
          "Meta is not configured. Set META_PAGE_ACCESS_TOKEN and META_PAGE_ID in .env.local.",
      },
      { status: 503 }
    );
  }

  let body: InitBody;
  try {
    body = (await request.json()) as InitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const slideCount = body.slideCount;
  if (
    typeof slideCount !== "number" ||
    !Number.isInteger(slideCount) ||
    slideCount < 1 ||
    slideCount > 10
  ) {
    return NextResponse.json(
      { error: "slideCount must be an integer from 1 to 10." },
      { status: 400 }
    );
  }

  const publishInstagram = body.publishInstagram !== false;
  const publishFacebook = body.publishFacebook === true;
  if (!publishInstagram && !publishFacebook) {
    return NextResponse.json(
      { error: "Enable at least one of publishInstagram or publishFacebook." },
      { status: 400 }
    );
  }

  const caption = stripEmDashes(
    typeof body.caption === "string" ? body.caption : ""
  );
  const scheduledPublishTime = parseScheduledField(body.scheduledPublishTime);

  const sessionId = createChunkSession({
    slideCount,
    caption,
    publishInstagram,
    publishFacebook,
    scheduledPublishTime,
  });

  return NextResponse.json({ sessionId, slideCount });
}
