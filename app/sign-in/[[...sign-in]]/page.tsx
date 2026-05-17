import { SignIn } from "@clerk/nextjs";

export const metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4 py-12">
      <SignIn />
    </main>
  );
}
