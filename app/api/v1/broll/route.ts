import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import {
  json,
  readJson,
  requiredStr,
  str,
  optStrArr,
} from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/** GET /api/v1/broll — list user's b-roll clips. */
export const GET = withUser(async ({ user }) => {
  const clips = await prisma.brollClip.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return json({ data: clips });
});

/** POST /api/v1/broll — upsert a b-roll clip (Studio supplies client id). */
export const POST = withUser(async ({ req, user }) => {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const id = requiredStr(body.id, "id");
  const storagePath = requiredStr(body.storagePath, "storagePath");
  const durationRaw = body.durationSeconds;
  if (typeof durationRaw !== "number" || !Number.isFinite(durationRaw)) {
    return new Response(
      JSON.stringify({
        title: "Bad request",
        status: 400,
        type: "/errors/bad-request",
        detail: "`durationSeconds` must be a number",
      }),
      { status: 400, headers: { "Content-Type": "application/problem+json" } },
    );
  }

  const data = {
    storageProvider: str(body.storageProvider) ?? "bunny-stream",
    storagePath,
    url: str(body.url) ?? null,
    durationSeconds: durationRaw,
    tags: optStrArr(body.tags) ?? [],
    name: str(body.name) ?? null,
  };

  const clip = await prisma.brollClip.upsert({
    where: { id },
    update: data,
    create: { id, userId: user.id, ...data },
  });
  return json({ data: clip });
});
