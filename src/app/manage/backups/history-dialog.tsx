"use client";

import { useRef, useState } from "react";
import { filterHistory, megabytes, type BackupRecord, type HistoryFilters } from "@/lib/backup-history";

function formatDate(at: Date) {
  return at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function History({ records }: { records: BackupRecord[] }) {
  const [filters, setFilters] = useState<HistoryFilters>({ query: "", result: "all", trigger: "all" });
  const shown = filterHistory(records, filters, formatDate);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          aria-label="Search backups"
          placeholder="Search, such as Nov 6"
          value={filters.query}
          onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          className="field min-w-40 flex-1"
        />
        <select
          aria-label="Result"
          value={filters.result}
          onChange={(event) => setFilters({ ...filters, result: event.target.value as HistoryFilters["result"] })}
          className="field"
        >
          <option value="all">All results</option>
          <option value="Completed">Completed</option>
          <option value="Running">Running</option>
          <option value="Failed">Failed</option>
        </select>
        <select
          aria-label="Type"
          value={filters.trigger}
          onChange={(event) => setFilters({ ...filters, trigger: event.target.value as HistoryFilters["trigger"] })}
          className="field"
        >
          <option value="all">All types</option>
          <option value="Nightly">Nightly</option>
          <option value="Manual">Manual</option>
        </select>
      </div>
      <p className="text-muted text-sm" aria-live="polite">
        Showing {shown.length} of {records.length}
      </p>
      <ul className="flex min-h-0 flex-1 flex-col divide-y divide-foreground/10 overflow-y-auto">
        {shown.map((record) => (
          <li key={record.id} className="flex flex-wrap justify-between gap-x-4 py-2 text-sm">
            <span>{formatDate(record.at)}</span>
            <span className="text-muted">
              <span className={record.result === "Failed" ? "text-(--down)" : undefined}>{record.result}</span>
              {` · ${record.trigger}`}
              {record.result === "Completed" && ` · ${megabytes(record.size)}`}
            </span>
          </li>
        ))}
        {shown.length === 0 && <li className="text-muted py-2 text-sm">No backups match.</li>}
      </ul>
    </>
  );
}

export function HistoryDialog({ name, records }: { name: string; records: BackupRecord[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // The list only exists while open, so closing clears the filters.
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
        className="text-muted text-sm underline"
      >
        History ({records.length})
      </button>
      <dialog
        ref={dialog}
        aria-label={`${name} backup history`}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
        className="panel m-auto w-[min(36rem,calc(100vw-2rem))] p-0 text-foreground"
      >
        <div className="flex h-[min(32rem,calc(100vh-4rem))] flex-col gap-3 p-5">
          <header className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-medium">{name}</h2>
            <button type="button" onClick={() => dialog.current?.close()} className="underline">
              Close
            </button>
          </header>
          {open && <History records={records} />}
        </div>
      </dialog>
    </>
  );
}
