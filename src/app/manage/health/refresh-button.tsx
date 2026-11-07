"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore, useTransition } from "react";

const subscribe = () => () => {};

export function RefreshButton({ checkedAt }: { checkedAt: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  // Formatted in the browser so the time is in the viewer's timezone, not the cluster's.
  const time = useSyncExternalStore(
    subscribe,
    () => new Date(checkedAt).toLocaleTimeString(),
    () => "",
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted text-sm" aria-live="polite">
        Updated {time} · refreshes every 30 seconds
      </p>
      <button
        type="button"
        className="btn-quiet"
        disabled={refreshing}
        onClick={() => startRefresh(() => router.refresh())}
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
