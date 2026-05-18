import { PrismaClient } from "@prisma/client";

/**
 * Singleton Prisma client.
 * Next.js hot-reload would otherwise create a new client on every reload —
 * this pattern reuses the same client across reloads in dev.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
