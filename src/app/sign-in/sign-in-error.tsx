"use client";

import { useSearchParams } from "next/navigation";

const messages: Record<string, string> = {
  OAuthSignin: "Couldn't reach the login service. Try again in a minute.",
  OAuthCallback: "The login service returned an error. Try again.",
  Callback: "The login didn't complete. Try again.",
  AccessDenied: "Your account doesn't have access to the hub.",
};

export function SignInError() {
  const error = useSearchParams().get("error");
  if (!error) return null;

  return (
    <p role="alert" className="max-w-md rounded-lg border border-(--down) px-4 py-3 text-(--down)">
      {messages[error] ?? "Sign-in failed. Try again."}
    </p>
  );
}
