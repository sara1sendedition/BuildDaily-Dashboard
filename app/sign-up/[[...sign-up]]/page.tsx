import { SignUp } from "@clerk/nextjs";
import { BuildDailyAuthBrand } from "@/app/components/BuildDailyAuthBrand";
import { buildDailyClerkAppearance } from "@/lib/clerk-appearance";

export const metadata = {
  title: "Sign up",
};

export default function SignUpPage() {
  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center gap-8 bg-[var(--bd-paper)] px-4 py-12">
      <BuildDailyAuthBrand />
      <SignUp appearance={buildDailyClerkAppearance} />
    </main>
  );
}
