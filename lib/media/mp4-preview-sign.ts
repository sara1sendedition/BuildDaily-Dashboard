import { createHmac, timingSafeEqual } from "crypto";

function signingSecret(): string {
  const s =
    process.env.MP4_PREVIEW_SIGNING_SECRET?.trim() ||
    process.env.SCHEDULE_DAEMON_SECRET?.trim() ||
    process.env.CLERK_SECRET_KEY?.trim() ||
    "";
  return s;
}

/** HMAC signature for cookie-less <video src> on iOS Safari. */
export function signMp4PreviewAccess(args: {
  bunnyUrl: string;
  userId: string;
  ttlSec?: number;
}): { exp: number; sig: string; userId: string } {
  const secret = signingSecret();
  if (!secret) {
    throw new Error("MP4 preview signing secret is not configured.");
  }
  const exp = Math.floor(Date.now() / 1000) + (args.ttlSec ?? 3600);
  const payload = `${args.userId}\n${exp}\n${args.bunnyUrl}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return { exp, sig, userId: args.userId };
}

export function verifyMp4PreviewAccess(args: {
  bunnyUrl: string;
  userId: string;
  exp: string | null;
  sig: string | null;
}): boolean {
  const secret = signingSecret();
  if (!secret || !args.exp || !args.sig || !args.userId) return false;
  const expNum = Number(args.exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const payload = `${args.userId}\n${expNum}\n${args.bunnyUrl}`;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(args.sig);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
