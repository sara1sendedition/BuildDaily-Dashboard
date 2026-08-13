/**
 * One-off: list / clear MultiplierQueueItem rows.
 *   npx tsx scripts/clear-multiplier-queue.ts
 *   npx tsx scripts/clear-multiplier-queue.ts --delete
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const del = process.argv.includes("--delete");
  const p = new PrismaClient();
  try {
    const rows = await p.multiplierQueueItem.findMany({
      select: {
        id: true,
        videoLabel: true,
        status: true,
        kind: true,
        userId: true,
        updatedAt: true,
        payload: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    for (const r of rows) {
      const pl =
        r.payload && typeof r.payload === "object"
          ? (r.payload as Record<string, unknown>)
          : {};
      const shortJobId =
        typeof pl.shortJobId === "string" ? pl.shortJobId : null;
      console.log(
        [
          r.id.slice(0, 8),
          r.status,
          r.kind ?? "-",
          r.videoLabel,
          shortJobId ? `job=${shortJobId.slice(0, 8)}` : "no-job",
          r.updatedAt.toISOString().slice(0, 10),
        ].join(" | "),
      );
    }
    console.log(`TOTAL ${rows.length}`);
    if (del) {
      const result = await p.multiplierQueueItem.deleteMany({});
      console.log(`DELETED ${result.count}`);
    } else {
      console.log("Dry run only. Pass --delete to clear all queue rows.");
    }
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
