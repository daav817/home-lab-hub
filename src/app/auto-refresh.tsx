"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Keeps the status lights current without reloading. Skips hidden tabs.
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);

  return null;
}
