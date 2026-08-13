/**
 * Shared BuildDaily Clerk UI tokens.
 * Keep in sync across Multiplier, Hub, and Comment Convert.
 *
 * Note: `appearance` styles embedded <SignIn>/<SignUp> only — not the hosted
 * Account Portal at accounts.builddaily.app. Prefer NEXT_PUBLIC_CLERK_SIGN_IN_URL
 * (and SIGN_UP_URL) pointing at each app's /sign-in so users never land on the
 * purple Clerk-hosted portal. Theme that portal in the Clerk Dashboard too
 * (primary #588064 + BD logo) as a fallback.
 */
export const BUILD_DAILY_CLERK_PRIMARY = "#588064"; // --bd-green-600
export const BUILD_DAILY_CLERK_PRIMARY_HOVER = "#466852"; // --bd-green-700
export const BUILD_DAILY_CLERK_PAPER = "#faf8f4"; // --bd-paper
export const BUILD_DAILY_CLERK_INK = "#1a1a1a"; // --bd-ink

/** Absolute URL so Clerk can load the mark even when the component is iframed. */
export const BUILD_DAILY_LOGO_URL =
  "https://app.builddaily.app/content-multiplier-logo.png?v=2";

export const buildDailyClerkAppearance = {
  variables: {
    colorPrimary: BUILD_DAILY_CLERK_PRIMARY,
    colorTextOnPrimaryBackground: "#ffffff",
    colorBackground: BUILD_DAILY_CLERK_PAPER,
    colorText: BUILD_DAILY_CLERK_INK,
    colorInputBackground: "#ffffff",
    borderRadius: "0.75rem",
  },
  // Clerk 7 uses `options`; older SDKs used `layout` — set both for safety.
  options: {
    logoImageUrl: BUILD_DAILY_LOGO_URL,
    logoLinkUrl: "https://app.builddaily.app",
    logoPlacement: "inside" as const,
  },
  layout: {
    logoImageUrl: BUILD_DAILY_LOGO_URL,
    logoLinkUrl: "https://app.builddaily.app",
    logoPlacement: "inside" as const,
  },
  elements: {
    formButtonPrimary: {
      backgroundColor: BUILD_DAILY_CLERK_PRIMARY,
      color: "#ffffff",
      "&:hover": {
        backgroundColor: BUILD_DAILY_CLERK_PRIMARY_HOVER,
      },
    },
    footerActionLink: {
      color: BUILD_DAILY_CLERK_PRIMARY,
    },
  },
};
