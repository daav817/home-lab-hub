"use client";

import { useActionState, useState, useTransition } from "react";
import type { Computer } from "@/lib/computers";
import { createComputer, deleteComputer, wakeComputer, type ComputerState } from "./actions";

export function ComputerList({ computers, meshUrl }: { computers: Computer[]; meshUrl: string }) {
  const [message, setMessage] = useState<ComputerState>({});
  const [pending, startTransition] = useTransition();
  const [added, addAction, adding] = useActionState(createComputer, {});

  const act = (action: () => Promise<ComputerState>) =>
    startTransition(async () => {
      setMessage(await action());
    });

  return (
    <>
      {message.error && <p role="alert" className="panel px-5 py-3 text-(--down)">{message.error}</p>}
      {message.done && <p className="panel px-5 py-3 text-(--up)">{message.done}</p>}

      <ul className="panel flex flex-col divide-y divide-foreground/10 px-5">
        {computers.length === 0 && <li className="text-muted py-4">No computers yet. Add one below.</li>}
        {computers.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span>
              <span className="font-medium">{c.name}</span>
              <span className="text-muted block text-sm">
                {c.mac}
                {c.note && ` · ${c.note}`}
              </span>
            </span>
            <span className="flex items-center gap-4">
              <button type="button" className="btn-quiet" disabled={pending} onClick={() => act(() => wakeComputer(c.id))}>
                Wake
              </button>
              <a href={meshUrl} target="_blank" rel="noopener" className="underline">
                Remote desktop
              </a>
              <button
                type="button"
                className="underline text-(--down)"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`Remove ${c.name} from this list? It stays in Remote desktop.`)) act(() => deleteComputer(c.id));
                }}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>

      <form action={addAction} className="panel flex flex-col gap-3 p-5">
        <h2 className="text-xl font-medium">Add a computer</h2>
        <div className="flex flex-wrap gap-3">
          <input name="name" required maxLength={60} placeholder="Name, such as Office PC" aria-label="Name" className="field min-w-40 flex-1" />
          <input name="mac" required placeholder="MAC, such as 3C-7C-3F-12-34-56" aria-label="MAC address" className="field min-w-52 flex-1" />
          <input name="note" maxLength={200} placeholder="Note (optional)" aria-label="Note" className="field min-w-40 flex-1" />
          <button type="submit" disabled={adding} className="btn-primary">
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
        {added.error && <p role="alert" className="text-sm text-(--down)">{added.error}</p>}
        {added.done && <p className="text-sm text-(--up)">{added.done}</p>}
        <p className="text-muted text-sm">
          On the PC, run <code>ipconfig /all</code> and copy the <em>Physical Address</em> of its wired (Ethernet)
          adapter. Wake-on-LAN works over a cable, not Wi-Fi.
        </p>
      </form>
    </>
  );
}
