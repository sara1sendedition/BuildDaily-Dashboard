import { SignUp } from "@clerk/nextjs";

export const metadata = {
  title: "Sign up",
};

export default function SignUpPage() {
  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4 py-12">
      <SignUp />
    </main>
  );
}
