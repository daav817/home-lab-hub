"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import type { BackupState } from "./actions";

export function BackUpNowButton({ action }: { action: () => Promise<BackupState> }) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <button type="submit" disabled={pending} className="btn-quiet">
        {pending ? "Starting…" : "Back up now"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-(--down)">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function RefreshButton() {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.refresh()} className="underline">
      Refresh
    </button>
  );
}
