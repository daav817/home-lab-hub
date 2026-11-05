"use client";

import { useActionState } from "react";
import type { FormState } from "./actions";
import type { ManagedApp } from "@/lib/db";

type Props = {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  app?: ManagedApp;
};

const input = "field";

export function AppForm({ action, app }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="panel flex max-w-xl flex-col gap-4 p-6">
      {state.error && (
        <p role="alert" className="rounded-lg border border-(--down) px-4 py-3 text-(--down)">
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
        className="btn-primary self-start"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
