import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Routes anyone can reach without signing in.
// Everything else requires a Clerk session — Phase A's "hard cutover" gate.
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/pricing",
  "/api/clerk/webhook",
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
