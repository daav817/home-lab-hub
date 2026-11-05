import { Suspense } from "react";
import { SignInButton } from "./sign-in-button";
import { SignInError } from "./sign-in-error";

export default function SignIn() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-8 text-center">
      <h1 className="brand-text text-5xl font-bold tracking-tight sm:text-7xl">
        Home Lab Hub
      </h1>
      <Suspense>
        <SignInError />
      </Suspense>
      <SignInButton />
    </main>
  );
}
