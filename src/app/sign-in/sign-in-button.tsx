"use client";

import { signIn } from "next-auth/react";

export function SignInButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("authentik", { callbackUrl: "/" })}
      className="rounded-lg bg-gradient-to-r from-cyan-500 via-violet-500 to-fuchsia-500 px-6 py-3 font-medium text-white"
    >
      Sign in
    </button>
  );
}
