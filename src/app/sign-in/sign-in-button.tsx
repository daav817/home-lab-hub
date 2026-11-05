"use client";

import { signIn } from "next-auth/react";

export function SignInButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("authentik", { callbackUrl: "/" })}
      className="btn-primary"
    >
      Sign in
    </button>
  );
}
