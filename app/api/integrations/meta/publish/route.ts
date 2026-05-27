import { NextResponse } from "next/server";
import {
  MetaGraphError,
  formatMetaUserFacingMessage,
} from "@/lib/meta/errors";
import {
  getMaxPublishBodyBytes,
  utf8ByteLength,
} from "@/lib/meta/publish-limits";
import { getMetaEnv, publishCarouselToMeta } from "@/lib/meta/publish";
import {
  parseScheduledField,
  futureScheduledOrUndefined,
} from "@/lib/meta/parse-scheduled-field";
import { stripEmDashes } from "@/lib/strip-em-dash";

export const runtime = "nodejs";
export const maxDuration = 300;

type PublishBody = {
  caption?: string;
  imagesBase64?: string[];
  publishInstagram?: boolean;
  publishFacebook?: boolean;
  /** ISO 8601 datetime string (local interpretation) or Unix seconds number */
  scheduledPublishTime?: number | string;
};

function formBool(
  v: FormDataEntryValue | null,
  defaultTrue: boolean
): boolean {
  if (v == null) return defaultTrue;
  const s = String(v).toLowerCase().trim();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return defaultTrue;
}

async function runPublish(input: {
  version: string;
  pageId: string;
  token: string;
  caption: string;
  publishInstagram: boolean;
  publishFacebook: boolean;
  scheduledPublishTime: number | undefined;
  imagesBase64?: string[];
  imagePngBuffers?: Buffer[];
}) {
  return publishCarouselToMeta({
    version: input.version,
    pageId: input.pageId,
    accessToken: input.token,
    caption: input.caption,
    publishInstagram: input.publishInstagram,
    publishFacebook: input.publishFacebook,
    scheduledPublishTime: input.scheduledPublishTime,
    ...(input.imagePngBuffers
      ? { imagePngBuffers: input.imagePngBuffers }
      : { imagesBase64: input.imagesBase64! }),
  });
}

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

  const maxBytes = getMaxPublishBodyBytes();
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const cl = request.headers.get("content-length");
    if (cl) {
      const n = parseInt(cl, 10);
      if (Number.isFinite(n) && n > maxBytes) {
        const mb = Math.round((n / (1024 * 1024)) * 10) / 10;
        const maxMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
        return NextResponse.json(
          {
            error: `Publish upload is too large (~${mb}MB). Limit ~${maxMb}MB (binary multipart counts toward this cap). Set META_PUBLISH_MAX_BODY_BYTES or use fewer slides.`,
          },
          { status: 413 }
        );
      }
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch (e) {
      console.error("[meta/publish] formData", e);
      return NextResponse.json(
        { error: "Could not read multipart body." },
        { status: 400 }
      );
    }

    const slideEntries = form.getAll("slide");
    const buffers: Buffer[] = [];
    for (const entry of slideEntries) {
      if (entry instanceof Blob && entry.size > 0) {
        buffers.push(Buffer.from(await entry.arrayBuffer()));
      }
    }

    if (buffers.length === 0) {
      return NextResponse.json(
        {
          error:
            "No slide images in upload. Send multipart field \"slide\" (PNG files) from the app, or JSON with imagesBase64.",
        },
        { status: 400 }
      );
    }

    const publishInstagram = formBool(form.get("publishInstagram"), true);
    const publishFacebook = formBool(form.get("publishFacebook"), false);

    if (!publishInstagram && !publishFacebook) {
      return NextResponse.json(
        { error: "Enable at least one of publishInstagram or publishFacebook." },
        { status: 400 }
      );
    }

    const caption = stripEmDashes(String(form.get("caption") ?? ""));
    // Past/near times mean "publish now" — drop them (see publish-reel route).
    const scheduledPublishTime = futureScheduledOrUndefined(
      parseScheduledField(
        form.get("scheduledPublishTime") as string | undefined
      )
    );

    try {
      const result = await runPublish({
        version: env.version,
        pageId: env.pageId,
        token: env.token,
        caption,
        publishInstagram,
        publishFacebook,
        scheduledPublishTime,
        imagePngBuffers: buffers,
      });
      return NextResponse.json(result);
    } catch (e) {
      if (e instanceof MetaGraphError) {
        return NextResponse.json(
          {
            error: formatMetaUserFacingMessage(e),
            meta: e.body,
          },
          { status: 502 }
        );
      }
      console.error("[meta/publish]", e);
      const message =
        e instanceof Error ? e.message : "Unknown error during publish.";
      return NextResponse.json(
        { error: `Server error while publishing: ${message}` },
        { status: 500 }
      );
    }
  }

  const rawText = await request.text();
  const byteLength = utf8ByteLength(rawText);
  if (byteLength > maxBytes) {
    const mb = Math.round((byteLength / (1024 * 1024)) * 10) / 10;
    const maxMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
    return NextResponse.json(
      {
        error: `Publish request is too large (~${mb}MB). This server allows ~${maxMb}MB. Prefer the app’s publish flow (multipart PNG — smaller than JSON base64), reduce slides, or set META_PUBLISH_MAX_BODY_BYTES.`,
      },
      { status: 413 }
    );
  }

  let body: PublishBody;
  try {
    body = JSON.parse(rawText) as PublishBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const imagesBase64 = body.imagesBase64;
  if (!Array.isArray(imagesBase64) || imagesBase64.length === 0) {
    return NextResponse.json(
      { error: "imagesBase64 must be a non-empty array of base64 PNG strings." },
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
  // Past/near times mean "publish now" — drop them (see publish-reel route).
  const scheduledPublishTime = futureScheduledOrUndefined(
    parseScheduledField(body.scheduledPublishTime)
  );

  try {
    const result = await runPublish({
      version: env.version,
      pageId: env.pageId,
      token: env.token,
      caption,
      publishInstagram,
      publishFacebook,
      scheduledPublishTime,
      imagesBase64,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof MetaGraphError) {
      return NextResponse.json(
        {
          error: formatMetaUserFacingMessage(e),
          meta: e.body,
        },
        { status: 502 }
      );
    }
    console.error("[meta/publish]", e);
    const message =
      e instanceof Error ? e.message : "Unknown error during publish.";
    return NextResponse.json(
      {
        error: `Server error while publishing: ${message}`,
      },
      { status: 500 }
    );
  }
}
