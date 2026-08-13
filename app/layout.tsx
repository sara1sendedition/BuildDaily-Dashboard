import type { Metadata } from "next";
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  Show,
  UserButton,
} from "@clerk/nextjs";
import { Poppins } from "next/font/google";
import { clientApiPath } from "@/lib/client-api-path";
import { BuildDailyNav } from "@/app/components/BuildDailyNav";
import { buildDailyClerkAppearance } from "@/lib/clerk-appearance";
import { Providers } from "./providers";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: {
    default: "BuildDaily",
    template: "%s | BuildDaily",
  },
  description:
    "From blank page to scheduled posts — Video Studio, Multiplier, calendar, and Comment Converter in one hub.",
  icons: {
    icon: clientApiPath("/content-multiplier-logo.png?v=2"),
  },
};

const authBtnClass =
  "rounded-lg bg-[var(--bd-green-600)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--bd-green-700)]";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className={`${poppins.className} antialiased`}>
        <ClerkProvider appearance={buildDailyClerkAppearance}>
          <header className="border-b border-[var(--bd-line)] bg-[var(--bd-paper)]/90 backdrop-blur-sm sticky top-0 z-40">
            <div className="mx-auto max-w-6xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <BuildDailyNav />
              <div className="flex items-center gap-3 shrink-0">
                <Show when="signed-out">
                  <SignInButton>
                    <button type="button" className={authBtnClass}>
                      Sign in
                    </button>
                  </SignInButton>
                  <SignUpButton>
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--bd-green-600)] bg-white px-3 py-1.5 text-sm font-semibold text-[var(--bd-green-700)] hover:bg-[var(--bd-green-50)]"
                    >
                      Sign up
                    </button>
                  </SignUpButton>
                </Show>
                <Show when="signed-in">
                  <UserButton />
                </Show>
              </div>
            </div>
          </header>
          <Providers>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
