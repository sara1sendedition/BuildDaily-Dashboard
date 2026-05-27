import { NextRequest, NextResponse } from "next/server";
import {
  hubToScheduledPost,
  type HubScheduleEntry,
} from "@/lib/schedule/hub-translator";
import {
  listScheduleEntriesOnHub,
  upsertScheduleEntryOnHub,
} from "@/lib/schedule/hub-server";
import {
  buildParsedLoadCarousel,
  parseLoadCarouselRequest,
  type ParsedLoadCarousel,
} from "@/lib/schedule/load-carousel-request";
import { authorizeScheduleApi, type ScheduleApiAuth } from "@/lib/schedule/schedule-api-auth";
import { resolveCarouselBunnyUrls } from "@/lib/storage/bunny-upload-server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/schedule/load-carousel
 *
 * Programmatically add carousel rows to the BuildDaily calendar (Hub schedule).
 * Intended for Claude, Cursor agents, and other automation.
 *
 * Auth (either):
 *   - `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>`
 *   - Signed-in Clerk session (browser cookie)
 *
 * Slides — option A (pre-hosted URLs):
 * ```json
 * { "slideUrls": ["https://cdn.example/s1.png"], ... }
 * ```
 *
 * Slides — option B (base64, uploaded to Bunny automatically):
 * ```json
 * {
 *   "slidesBase64": ["<base64 png>", "..."],
 *   "slidesInstagramBase64": ["<optional 4:5 slides>"],
 *   ...
 * }
 * ```
 *
 * You can mix pre-hosted `slideUrls` with `slidesInstagramBase64` uploads.
 *
 * When using daemon auth, set `SCHEDULE_IMPORT_USER_ID` or pass `userId`.
 */

/**
 * GET /api/schedule/load-carousel
 *
 * List calendar entries (same auth as POST). Query: `?unposted=1`
 */
export async function GET(req: NextRequest) {
  const authResult = await authorizeScheduleApi(req);
  if (authResult instanceof NextResponse) return authResult;

  const unposted = req.nextUrl.searchParams.get("unposted") === "1";
  const userId = req.nextUrl.searchParams.get("userId")?.trim() || undefined;

  const listed = await listScheduleEntriesOnHub(authResult, {
    unposted,
    userId,
  });
  if (!listed.ok) {
    return NextResponse.json(
      { error: listed.message },
      { status: listed.status || 502 },
    );
  }

  const items = listed.data
    .map(hubToScheduledPost)
    .sort((a, b) => a.publishAtUnix - b.publishAtUnix);

  return NextResponse.json({ ok: true, data: items });
}

async function prepareCarouselForHub(
  item: ParsedLoadCarousel,
  auth: ScheduleApiAuth,
  userId?: string,
): Promise<
  | { ok: true; hubBody: ParsedLoadCarousel["hubBody"] }
  | { ok: false; status: number; error: string }
> {
  const resolved = await resolveCarouselBunnyUrls(
    item.row.bunnyUrls,
    item.pendingUpload,
    auth,
    userId,
  );
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, error: resolved.message };
  }

  const ready = buildParsedLoadCarousel({
    ...item.row,
    bunnyUrls: resolved.data,
  });
  return { ok: true, hubBody: ready.hubBody };
}

export async function POST(req: NextRequest) {
  const authResult = await authorizeScheduleApi(req);
  if (authResult instanceof NextResponse) return authResult;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseLoadCarouselRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const saved: HubScheduleEntry[] = [];
  const errors: Array<{ index: number; id: string; error: string; status: number }> = [];
  const userId =
    typeof (body as Record<string, unknown>).userId === "string"
      ? String((body as Record<string, unknown>).userId).trim()
      : undefined;

  for (let i = 0; i < parsed.items.length; i += 1) {
    const item = parsed.items[i]!;
    const prepared = await prepareCarouselForHub(item, authResult, userId);
    if (!prepared.ok) {
      errors.push({
        index: i,
        id: item.row.id,
        error: prepared.error,
        status: prepared.status,
      });
      continue;
    }

    const upserted = await upsertScheduleEntryOnHub(
      userId ? { ...prepared.hubBody, userId } : prepared.hubBody,
      authResult,
    );
    if (!upserted.ok) {
      errors.push({
        index: i,
        id: item.row.id,
        error: upserted.message,
        status: upserted.status,
      });
      continue;
    }
    saved.push(upserted.data);
  }

  if (saved.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "No carousels were saved.",
        errors,
      },
      { status: errors[0]?.status ?? 500 },
    );
  }

  const data = saved.map(hubToScheduledPost);
  return NextResponse.json({
    ok: true,
    data,
    ...(errors.length > 0 ? { partial: true, errors } : {}),
  });
}
