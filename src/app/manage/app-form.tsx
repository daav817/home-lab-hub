"use client";

import { useActionState } from "react";
import type { FormState } from "./actions";
import type { ManagedApp } from "@/lib/db";

type Props = {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  app?: ManagedApp;
};

const input = "rounded-lg border border-current/30 bg-transparent px-3 py-2";

export function AppForm({ action, app }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-lg border border-rose-500 px-4 py-3 text-rose-500">
          {state.error}
        </p>
      )}
      <label className="flex flex-col gap-1">
        Name
        <input name="name" required maxLength={80} defaultValue={app?.name} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Description
        <input name="description" maxLength={200} defaultValue={app?.description} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Address
        <input name="url" type="url" required defaultValue={app?.url} placeholder="https://" className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Status check address (optional, checked from inside the cluster)
        <input name="statusUrl" type="url" defaultValue={app?.statusUrl ?? ""} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Section
        <input name="category" required maxLength={40} defaultValue={app?.category ?? "Family"} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Who can see it
        <select name="audience" defaultValue={app?.audience ?? "family"} className={input}>
          <option value="everyone">Everyone, including limited members</option>
          <option value="family">Family and admins</option>
          <option value="admin">Admins only</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Order (lower comes first)
        <input name="sortOrder" type="number" min={0} max={10000} defaultValue={app?.sortOrder ?? 100} className={input} />
      </label>
      <label className="flex items-center gap-2">
        <input name="hidden" type="checkbox" defaultChecked={app?.hidden} />
        Hidden
      </label>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-gradient-to-r from-cyan-500 via-violet-500 to-fuchsia-500 px-6 py-2 font-medium text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
