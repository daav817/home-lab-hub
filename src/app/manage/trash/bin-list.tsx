"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatBytes } from "@/lib/files";
import { checkBins, emptyShareBin, type FileActionState } from "@/app/files/actions";
import { binHref } from "./bin-href";

type Bin = { share: string; bytes: number; files: number; error?: string };

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function BinList({ bins, checkedAt }: { bins: Bin[]; checkedAt: string | null }) {
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

  const total = bins.reduce((n, b) => n + b.bytes, 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-quiet" disabled={pending} onClick={() => run(checkBins)}>
          {pending ? "Working…" : "Check now"}
        </button>
        <span className="text-muted text-sm">
          {checkedAt ? `Last checked ${when.format(new Date(checkedAt))}` : "Not checked yet"}
          {total ? ` · ${formatBytes(total)} in all` : ""}
        </span>
        {message.error && <span role="alert" className="text-sm text-(--down)">{message.error}</span>}
        {message.done && <span className="text-sm text-(--up)">{message.done}</span>}
      </div>
      {bins.length === 0 ? (
        <p className="panel text-muted px-5 py-4">No results yet. Use Check now, or wait a few minutes after the hub starts.</p>
      ) : (
        <ul className="panel flex flex-col divide-y divide-foreground/10 px-4">
          {bins.map((bin) => (
            <li key={bin.share} className="flex flex-wrap items-center gap-3 py-3">
              <span aria-hidden>🗑️</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{bin.share}</span>
                <span className={`truncate text-sm ${bin.error ? "text-(--down)" : "text-muted"}`}>
                  {bin.error ?? (bin.files ? `${formatBytes(bin.bytes)} · ${bin.files} file${bin.files === 1 ? "" : "s"}` : "Empty")}
                </span>
              </span>
              {bin.files > 0 && (
                <>
                  <Link href={binHref(bin.share)} className="btn-quiet">
                    Open
                  </Link>
                  <button
                    type="button"
                    className="text-sm text-(--down) underline"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Delete all ${bin.files} files (${formatBytes(bin.bytes)}) in the ${bin.share} recycle bin for good? This can't be undone.`)) {
                        run(() => emptyShareBin(bin.share));
                      }
                    }}
                  >
                    Empty
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
