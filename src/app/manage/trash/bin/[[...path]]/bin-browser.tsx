"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatBytes, type Entry } from "@/lib/files";
import { deleteBinItem, restoreBinItem, type FileActionState } from "@/app/files/actions";
import { binHref } from "../../bin-href";

const when = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" });

export function BinBrowser({ share, parts, entries }: { share: string; parts: string[]; entries: Entry[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<FileActionState>({});
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<FileActionState>) =>
    startTransition(async () => {
      setMessage({});
      const result = await action();
      setMessage(result);
      router.refresh();
    });

  const files = entries.filter((e) => !e.isDir);
  const size = files.reduce((n, e) => n + e.size, 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted text-sm">
          {entries.length} item{entries.length === 1 ? "" : "s"} here
          {files.length ? ` · ${formatBytes(size)} in files (folders not counted)` : ""}
        </span>
        {pending && <span className="text-muted text-sm">Working…</span>}
        {message.error && <span role="alert" className="text-sm text-(--down)">{message.error}</span>}
        {message.done && <span className="text-sm text-(--up)">{message.done}</span>}
      </div>
      {entries.length === 0 ? (
        <p className="panel text-muted px-5 py-4">Nothing here.</p>
      ) : (
        <ul className="panel flex flex-col divide-y divide-foreground/10 px-4">
          {entries.map((entry) => {
            const path = [...parts, entry.name];
            return (
              <li key={entry.name} className="flex flex-wrap items-center gap-3 py-3">
                <span aria-hidden>{entry.isDir ? "📁" : "📄"}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  {entry.isDir ? (
                    <Link href={binHref(share, path)} className="truncate font-medium underline">
                      {entry.name}
                    </Link>
                  ) : (
                    <span className="truncate font-medium">{entry.name}</span>
                  )}
                  <span className="text-muted truncate text-sm">
                    {entry.isDir ? "folder" : formatBytes(entry.size)}
                    {entry.modified ? ` · last changed ${when.format(new Date(entry.modified))}` : ""}
                  </span>
                </span>
                <button type="button" className="btn-quiet" disabled={pending} onClick={() => run(() => restoreBinItem(share, path))}>
                  Restore
                </button>
                <button
                  type="button"
                  className="text-sm text-(--down) underline"
                  disabled={pending}
                  onClick={() => {
                    const what = entry.isDir ? `the folder ${entry.name} and everything in it` : entry.name;
                    if (window.confirm(`Delete ${what} for good? This can't be undone.`)) run(() => deleteBinItem(share, path, entry.isDir));
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
