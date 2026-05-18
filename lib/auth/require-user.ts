import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export interface AuthedUser {
  /** Clerk user id, e.g. user_xxxxxxxx */
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  membershipType: "free" | "pro" | "team";
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Resolves the current Clerk session to a row in our `users` table.
 *
 * On first sight of a Clerk identity, this upserts a row keyed on the Clerk
 * user id. On subsequent requests it refreshes denormalized fields (email,
 * fullName, avatarUrl) so they stay in sync with Clerk's profile.
 *
 * Throws UnauthorizedError if no Clerk session is active or the Clerk
 * user has no email.
 */
export async function requireUser(): Promise<AuthedUser> {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError("Not signed in");
  }

  const clerkUser = await currentUser();
  const email =
    clerkUser?.primaryEmailAddress?.emailAddress ??
    clerkUser?.emailAddresses?.[0]?.emailAddress ??
    null;

  if (!email) {
    throw new UnauthorizedError("Clerk user has no email on file");
  }

  const user = await prisma.user.upsert({
    where: { id: userId },
    update: {
      email,
      fullName: clerkUser?.fullName ?? null,
      avatarUrl: clerkUser?.imageUrl ?? null,
    },
    create: {
      id: userId,
      email,
      fullName: clerkUser?.fullName ?? null,
      avatarUrl: clerkUser?.imageUrl ?? null,
      membershipType: "free",
    },
  });

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    membershipType: user.membershipType as AuthedUser["membershipType"],
  };
}
