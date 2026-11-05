"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/sign-in" })}
      className="rounded-lg border border-current px-4 py-2 opacity-70"
    >
      Sign out
    </button>
  );
}
