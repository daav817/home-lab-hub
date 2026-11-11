"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatBytes } from "@/lib/files";
import { deleteFromTrash, emptyTrash, restoreFromTrash, type FileActionState } from "@/app/files/actions";

type Item = {
  id: string;
  share: string;
  original: string;
  isDir: boolean;
  size: number;
  deletedBy: string;
  deletedAt: string;
  expiresAt: string;
};

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function TrashList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<FileActionState>({});
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<FileActionState>) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result);
      router.refresh();
    });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-quiet text-(--down)"
          disabled={pending || items.length === 0}
          onClick={() => {
            if (window.confirm(`Delete all ${items.length} item${items.length === 1 ? "" : "s"} in the Trash for good? This can't be undone.`)) run(emptyTrash);
          }}
        >
          Empty Trash
        </button>
        {message.error && <span role="alert" className="text-sm text-(--down)">{message.error}</span>}
        {message.done && <span className="text-sm text-(--up)">{message.done}</span>}
      </div>
      {items.length === 0 ? (
        <p className="panel text-muted px-5 py-4">The Trash is empty.</p>
      ) : (
        <ul className="panel flex flex-col divide-y divide-foreground/10 px-4">
          {items.map((item) => {
            const name = item.original.split("/").at(-1);
            const folder = [item.share, ...item.original.split("/").slice(0, -1)].join("/");
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <span aria-hidden>{item.isDir ? "📁" : "📄"}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{name}</span>
                  <span className="text-muted truncate text-sm">
                    from {folder} · {item.isDir ? "folder" : formatBytes(item.size)} · deleted by {item.deletedBy}{" "}
                    {when.format(new Date(item.deletedAt))} · gone for good {day.format(new Date(item.expiresAt))}
                  </span>
                </span>
                <button type="button" className="btn-quiet" disabled={pending} onClick={() => run(() => restoreFromTrash(item.id))}>
                  Restore
                </button>
                <button
                  type="button"
                  className="text-sm text-(--down) underline"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Delete ${name} for good? This can't be undone.`)) run(() => deleteFromTrash(item.id));
                  }}
                >
                  Delete forever
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
