import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  errors,
  json,
  readJson,
  requiredStr,
  str,
} from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/projects — list user's projects. */
export const GET = withUser(async ({ user }) => {
  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return json({ data: projects });
});

/**
 * POST /api/v1/projects — upsert (Studio supplies client-side ids,
 * so this acts as create-or-update).
 */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const id = requiredStr(body.id, "id");
  const name = requiredStr(body.name, "name");
  const type = requiredStr(body.type, "type");
  if (type !== "build-in-public" && type !== "challenge") {
    return errors.badRequest(
      "`type` must be 'build-in-public' or 'challenge'",
    );
  }

  const data = {
    name,
    type,
    description: str(body.description) ?? null,
    brandId: str(body.brandId) ?? null,
    brandName: str(body.brandName) ?? null,
    segmentPrompts: (body.segmentPrompts ?? []) as Prisma.InputJsonValue,
    // Prisma JSON columns don't accept JS null directly; use Prisma.DbNull
    // to clear the column.
    quickPlanSchedule:
      body.quickPlanSchedule == null
        ? Prisma.DbNull
        : (body.quickPlanSchedule as Prisma.InputJsonValue),
    videoStyleDefaults:
      body.videoStyleDefaults == null
        ? Prisma.DbNull
        : (body.videoStyleDefaults as Prisma.InputJsonValue),
    teleprompterSettings:
      body.teleprompterSettings == null
        ? Prisma.DbNull
        : (body.teleprompterSettings as Prisma.InputJsonValue),
    videoOrientation:
      str(body.videoOrientation) === "vertical" ||
      str(body.videoOrientation) === "horizontal"
        ? (str(body.videoOrientation) as "vertical" | "horizontal")
        : null,
  };

  const project = await prisma.project.upsert({
    where: { id },
    update: data,
    create: { id, userId: user.id, ...data },
  });
  return json({ data: project });
});
