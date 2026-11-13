"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { formatBytes } from "@/lib/files";
import {
  confirmBackupDeletes, getMirrorView, runMirror, setMirror, stopMirrorRun, type MirrorState, type MirrorView,
} from "@/app/files/mirror-actions";
import { ConfirmDialog } from "./confirm-dialog";

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const STATUS: Record<string, string> = {
  running: "Running",
  stopping: "Stopping",
  done: "Finished",
  failed: "Finished with problems",
  stopped: "Stopped",
  interrupted: "Cut short by a hub restart (the next run picks up where it left off)",
};

const TRIGGER: Record<string, string> = { manual: "started by hand", nightly: "nightly", "after-organize": "after new uploads were sorted" };

function duration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// Files page (admins): the backup of photo/video/music to the second drive (src/lib/mirror.ts).
export function MirrorPanel() {
  const [view, setView] = useState<MirrorView | null>(null);
  const [message, setMessage] = useState<MirrorState>({});
  const [pending, startTransition] = useTransition();
  const [reviewing, setReviewing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    getMirrorView().then(setView).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const running = view?.run?.status === "running" || view?.run?.status === "stopping";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const act = (action: () => Promise<MirrorState>, after?: () => void) =>
    startTransition(async () => {
      setMessage({});
      const result = await action();
      setMessage(result);
      after?.();
      refresh();
    });

  if (!view) return null;
  const { run, config } = view;
  const key = (p: { share: string; path: string }) => `${p.share}/${p.path}`;
  const pickedItems = view.pending.filter((p) => picked.has(key(p)));

  return (
    <section className="panel flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Backup to {config.target}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={view.enabled} disabled={pending} onChange={(e) => act(() => setMirror(e.target.checked))} />
          Back up automatically
        </label>
      </div>
      <p className="text-muted text-sm">
        Copies {config.shares.join(", ")} to the same folders in {config.target} on the backup drive: right after new uploads
        are sorted, and every night. Nothing is deleted from the backup until you confirm it below.
      </p>

      {run && (
        <div className="flex flex-col gap-1 text-sm">
          <span>
            <span className="font-medium">{STATUS[run.status] ?? run.status}</span>
            {" · "}
            {TRIGGER[run.trigger] ?? run.trigger}, {when.format(new Date(run.startedAt))}
            {run.finishedAt ? ` · took ${duration(new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())}` : ""}
          </span>
          {running && run.current && (
            <span className="text-muted">
              Copying {run.current}
              {run.progress && run.progress.totalBytes > 0
                ? `: ${formatBytes(run.progress.bytes)} of ${formatBytes(run.progress.totalBytes)} (${run.progress.transfers} of ${run.progress.totalTransfers} files)`
                : ": comparing the two drives…"}
              {run.progress?.eta ? `, about ${duration(run.progress.eta * 1000)} left` : ""}
            </span>
          )}
          {run.shares.map((s) => (
            <span key={s.share} className={s.error ? "text-(--down)" : "text-muted"}>
              {s.share}: {s.error ? s.error : `${s.copied} file${s.copied === 1 ? "" : "s"} copied (${formatBytes(s.bytes)})`}
              {s.errors ? `, ${s.errors} error${s.errors === 1 ? "" : "s"}` : ""}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <button type="button" className="btn-quiet" disabled={pending || run?.status === "stopping"} onClick={() => act(stopMirrorRun)}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn-primary" disabled={pending} onClick={() => act(runMirror)}>
            Run now
          </button>
        )}
        {message.error && <span role="alert" className="text-sm text-(--down)">{message.error}</span>}
        {message.done && <span className="text-sm text-(--up)">{message.done}</span>}
      </div>

      {view.pendingCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-(--down) px-4 py-3 text-sm">
          <span className="flex-1">
            <span className="font-medium">{view.pendingCount} file{view.pendingCount === 1 ? " was" : "s were"} removed from the main drive</span>{" "}
            ({formatBytes(view.pendingBytes)}) but {view.pendingCount === 1 ? "is" : "are"} still on the backup.
          </span>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              setPicked(new Set(view.pending.map(key)));
              setReviewing(true);
            }}
          >
            Review
          </button>
        </div>
      )}

      <ConfirmDialog
        open={reviewing}
        title="Delete from the backup?"
        confirmLabel={`Delete ${pickedItems.length} from the backup`}
        danger
        busy={pending}
        onCancel={() => setReviewing(false)}
        onConfirm={() => {
          if (pickedItems.length === 0) return;
          const all = pickedItems.length === view.pendingCount;
          act(() => confirmBackupDeletes(all ? "all" : pickedItems.map((p) => ({ share: p.share, path: p.path }))), () => setReviewing(false));
        }}
      >
        <p>
          These files are no longer on the main drive. Deleting them from {config.target} makes the two drives match again,
          and they can&apos;t be recovered afterwards. Untick anything you want to keep: to keep a file for good, put it back on the main drive.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={pickedItems.length === view.pending.length}
            onChange={(e) => setPicked(e.target.checked ? new Set(view.pending.map(key)) : new Set())}
          />
          All {view.pending.length}
        </label>
        <ul className="flex flex-col divide-y divide-foreground/10">
          {view.pending.map((p) => (
            <li key={key(p)} className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                aria-label={key(p)}
                checked={picked.has(key(p))}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(key(p));
                  else next.delete(key(p));
                  setPicked(next);
                }}
              />
              <span className="min-w-0 flex-1 truncate">{key(p)}</span>
              <span className="text-muted">{formatBytes(p.size)}</span>
            </li>
          ))}
        </ul>
        {view.pendingCount > view.pending.length && (
          <p className="text-muted">Showing the first {view.pending.length} of {view.pendingCount}.</p>
        )}
      </ConfirmDialog>
    </section>
  );
}
