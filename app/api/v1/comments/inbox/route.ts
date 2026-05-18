import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { json } from "@/app/api/v1/_lib/responses";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

/**
 * GET /api/v1/comments/inbox
 *
 * Query params:
 *   ?filter=needsResponse | conversionReady | archived | ignored | all (default: surfaced)
 *   ?limit=50  (default 50, max 200)
 *   ?platform=YOUTUBE | INSTAGRAM | TIKTOK | FACEBOOK
 *
 * Returns each comment joined with: classification (latest), inboxViewState,
 * draftReplies (any), commenterProfile.
 */
export const GET = withUser(async ({ req, user }) => {
  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") ?? "surfaced";
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );
  const platform = url.searchParams.get("platform");

  let stateWhere: Prisma.InboxViewStateWhereInput = {};
  switch (filter) {
    case "needsResponse":
      stateWhere = { needsResponse: true, archived: false };
      break;
    case "conversionReady":
      stateWhere = { conversionReady: true, archived: false };
      break;
    case "archived":
      stateWhere = { archived: true };
      break;
    case "ignored":
      stateWhere = { ignored: true };
      break;
    case "all":
      stateWhere = {};
      break;
    case "surfaced":
    default:
      stateWhere = { surfaced: true, archived: false, ignored: false };
      break;
  }

  const where: Prisma.CommentWhereInput = {
    userId: user.id,
    ...(platform
      ? {
          platform: platform as
            | "YOUTUBE"
            | "INSTAGRAM"
            | "TIKTOK"
            | "FACEBOOK",
        }
      : {}),
    inboxViewState: stateWhere,
  };

  const comments = await prisma.comment.findMany({
    where,
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: {
      classifications: {
        orderBy: { version: "desc" },
        take: 1,
      },
      inboxViewState: true,
      draftReplies: { orderBy: { createdAt: "desc" }, take: 3 },
      commenterProfile: {
        select: {
          handle: true,
          followerCount: true,
          commentCount: true,
        },
      },
      contentItem: {
        select: { title: true, url: true, platform: true },
      },
    },
  });

  return json({ data: comments });
});
