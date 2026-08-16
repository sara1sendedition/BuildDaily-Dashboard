import { NextResponse } from "next/server";
import {
  requireUser,
  UnauthorizedError,
  type AuthedUser,
} from "@/lib/auth/require-user";

function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ownerUserIds(): Set<string> {
  return new Set([
    ...splitList(process.env.OWNER_USER_IDS),
    ...splitList(process.env.SCHEDULE_IMPORT_USER_ID),
    // Internal Send Edition accounts — Stitch auto-group is not a customer feature.
    "user_3Ddu64guH01n7Bl3vsk07yC4JeE",
    "user_3HvSnmvJf79FFLE4bHB9WNUV6tj",
  ]);
}

function ownerEmails(): Set<string> {
  return new Set(
    [
      ...splitList(process.env.OWNER_EMAILS),
      "sara@sendedition.com",
      "sara.sendedition@gmail.com",
    ].map((s) => s.toLowerCase())
  );
}

/** Owner allowlist, or `team` membership (internal account). Not a customer feature. */
export function isOwnerAccount(
  user: Pick<AuthedUser, "id" | "email" | "membershipType">
): boolean {
  if (ownerUserIds().has(user.id)) return true;
  if (ownerEmails().has(user.email.trim().toLowerCase())) return true;
  return user.membershipType === "team";
}

export async function ownerApiGuard(): Promise<NextResponse | null> {
  try {
    const user = await requireUser();
    if (!isOwnerAccount(user)) {
      return NextResponse.json(
        { error: "Not available for this account." },
        { status: 403 }
      );
    }
    return null;
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

export async function ownerAutoGroupAllowed(): Promise<boolean> {
  try {
    const user = await requireUser();
    return isOwnerAccount(user);
  } catch (e) {
    if (e instanceof UnauthorizedError) return false;
    throw e;
  }
}
