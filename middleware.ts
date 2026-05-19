import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Routes anyone can reach without signing in.
// Everything else requires a Clerk session — Phase A's "hard cutover" gate.
//
// `/api/v1/internal/*` is intentionally outside Clerk because cross-app
// crons (e.g. Multiplier's publish-due) can't carry a Clerk session.
// Those routes enforce their own `Authorization: Bearer <SCHEDULE_DAEMON_SECRET>`
// shared-secret auth — see app/api/v1/internal/*/route.ts.
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/pricing",
  "/api/clerk/webhook",
  "/api/v1/internal/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
