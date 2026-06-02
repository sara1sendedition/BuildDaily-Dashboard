import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Routes anyone can reach without signing in.
// Everything else requires a Clerk session — Phase A's "hard cutover" gate.
//
// `/api/v1/internal/*` is intentionally outside Clerk because cross-app
// crons (e.g. publish-due) can't carry a Clerk session.
// Those routes enforce their own `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>`.
//
// `/api/schedule/*` is also public to Clerk because publish-now, load-carousel,
// and legacy daemon-upsert routes carry their own Bearer secret auth
// (see `lib/schedule/daemon-auth.ts` and `lib/schedule/schedule-api-auth.ts`).
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/pricing",
  "/api/clerk/webhook",
  "/api/v1/internal/(.*)",
  "/api/schedule/(.*)",
]);

// Sibling BuildDaily apps allowed to call the hub's /api/v1 cross-origin with
// credentials. The whole suite is one Clerk identity on *.builddaily.app, so
// the shared session cookie is sent on these requests — but the browser still
// requires explicit CORS headers (with a specific origin, not "*", because we
// use credentials). Without this, Studio/CC calls fail with "Failed to fetch".
const TRUSTED_ORIGINS = new Set([
  "https://hub.builddaily.app",
  "https://studio.builddaily.app",
  "https://cc.builddaily.app",
  "https://app.builddaily.app",
]);

function corsHeadersFor(origin: string | null): Headers {
  const headers = new Headers();
  if (origin && TRUSTED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set(
      "Access-Control-Allow-Methods",
      "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    );
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Max-Age", "86400");
    headers.set("Vary", "Origin");
  }
  return headers;
}

export default clerkMiddleware(async (auth, req) => {
  const isApiV1 = req.nextUrl.pathname.startsWith("/api/v1");
  const origin = req.headers.get("origin");

  // CORS preflight: answer BEFORE Clerk auth (preflight carries no cookies and
  // must never be redirected to sign-in).
  if (isApiV1 && req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeadersFor(origin) });
  }

  if (!isPublic(req)) {
    await auth.protect();
  }

  // Attach CORS headers to the actual /api/v1 response for trusted origins.
  if (isApiV1 && origin && TRUSTED_ORIGINS.has(origin)) {
    const res = NextResponse.next();
    corsHeadersFor(origin).forEach((value, key) => res.headers.set(key, value));
    return res;
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
