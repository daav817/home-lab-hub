"use client";

import { signOut } from "next-auth/react";

// Clears the hub's cookie, then ends the Authentik session too (see src/lib/sign-out.ts).
async function signOutEverywhere() {
  let next: string | null = null;
  try {
    const response = await fetch("/api/sign-out", { cache: "no-store", redirect: "manual" });
    if (response.ok) next = ((await response.json()) as { url: string | null }).url;
  } catch {
    // Fall back to signing out of the hub only.
  }
  await signOut({ redirect: !next, callbackUrl: "/sign-in" });
  if (next) window.location.assign(next);
}

export function SignOutButton() {
  return (
    <button type="button" onClick={() => void signOutEverywhere()} className="btn-quiet">
      Sign out
    </button>
  );
}
