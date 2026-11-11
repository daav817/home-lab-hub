"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatBytes, type Entry } from "@/lib/files";
import { planMoves } from "@/lib/media";
import type { TidyPlan } from "@/lib/organizer";
import {
  getOrganizeStatus, getTidyPlan, organizeAll, saveNightly, stopOrganizing, tidyAll, type OrganizeState, type OrganizeStatus,
} from "../organize-actions";
import { ConfirmDialog } from "./confirm-dialog";

const when = (at: Date | string) => new Date(at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
const hourLabel = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString("en-US", { hour: "numeric" });

const STATUS_TEXT: Record<string, string> = {
  done: "Finished",
  stopped: "Stopped",
  failed: "Failed",
  interrupted: "Cut short by a hub restart",
};

// Status of the mover, checked every 3 s while a run is going (the page's listing is reloaded
// when it ends, so moved files drop out of it).
export function useOrganizeStatus(enabled: boolean): [OrganizeStatus | null, () => void] {
  const router = useRouter();
  const [status, setStatus] = useState<OrganizeStatus | null>(null);
  const wasRunning = useRef(false);

  const refresh = useCallback(() => {
    if (!enabled) return;
    getOrganizeStatus().then((next) => {
      const running = next?.run?.status === "running" || next?.run?.status === "stopping";
      if (wasRunning.current && !running) router.refresh();
      wasRunning.current = running;
      setStatus(next);
    }).catch(() => {});
  }, [enabled, router]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const running = status?.run?.status === "running" || status?.run?.status === "stopping";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [running, refresh]);

  return [status, refresh];
}

// source: the upload folder itself; inside: a subfolder of it; tidy: the photo or video share.
type Props = { status: OrganizeStatus | null; refresh: () => void; mode: "source" | "inside" | "tidy"; entries: Entry[] };

export function OrganizePanel({ status, refresh, mode, entries }: Props) {
  const atSource = mode === "source";
  const [message, setMessage] = useState<OrganizeState>({});
  const [askAll, setAskAll] = useState(false);
  const [askTidy, setAskTidy] = useState(false);
  const [tidyPlan, setTidyPlan] = useState<TidyPlan | { error: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<{ enabled: boolean; hour: number } | null>(null);
  const plan = useMemo(() => (askAll ? planMoves(entries.filter((e) => !e.isDir)) : null), [askAll, entries]);

  const run = status?.run ?? null;
  const running = run?.status === "running" || run?.status === "stopping";
  const nightly = draft ?? status?.nightly ?? { enabled: false, hour: 1 };
  const changed = draft !== null && (draft.enabled !== status?.nightly.enabled || draft.hour !== status?.nightly.hour);

  const act = (action: () => Promise<OrganizeState>, after?: () => void) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result);
      setAskAll(false);
      setAskTidy(false);
      after?.();
      refresh();
    });

  return (
    <div className="panel flex flex-col gap-3 px-5 py-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium">{mode === "tidy" ? "Sort into month folders" : "Move to Photos and Videos"}</h2>
        {atSource && (
          <button type="button" className="btn-quiet" disabled={pending || running} onClick={() => setAskAll(true)}>
            Move all now
          </button>
        )}
        {mode === "tidy" && (
          <button
            type="button"
            className="btn-quiet"
            disabled={pending || running}
            onClick={() => {
              setTidyPlan(null);
              setAskTidy(true);
              getTidyPlan().then(setTidyPlan).catch(() => setTidyPlan({ error: "Couldn't read the photo and video folders." }));
            }}
          >
            Sort photo and video now
          </button>
        )}
      </div>
      {mode === "tidy" ? (
        <p className="text-muted">
          Photos and videos lying straight in a year folder (like <code>2023/20230101_201514.jpg</code>) go into that
          year&apos;s month folder (<code>2023/2023-01/</code>), made if missing, in both <strong>photo</strong> and{" "}
          <strong>video</strong>. Named folders are left alone. These are quick renames on the router.
        </p>
      ) : (
        <p className="text-muted">
          JPG, PNG and HEIC files go to <strong>photo</strong>, MP4, AVI and MOV to <strong>video</strong>, in{" "}
          <code>year/year-month</code> folders (made if missing) by the date in the file name. Tick files below and
          choose <em>Move to Photos/Videos</em>, or move everything at the top of this folder.
        </p>
      )}

      {running && run && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <div className="flex flex-wrap justify-between gap-2">
            <span>
              {run.status === "stopping" ? "Stopping… " : "Moving "}
              {run.done} of {run.total} · {formatBytes(run.movedBytes)} moved
              {run.skippedCount > 0 && ` · ${run.skippedCount} skipped`}
              {run.failedCount > 0 && <span className="text-(--down)"> · {run.failedCount} failed</span>}
            </span>
            <button type="button" className="underline" disabled={pending || run.status === "stopping"} onClick={() => act(stopOrganizing)}>
              Stop
            </button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full bg-(--cyan)" style={{ width: `${run.total ? Math.round((run.done / run.total) * 100) : 0}%` }} />
          </div>
          {run.current && <span className="text-muted truncate">Now: {run.current}</span>}
        </div>
      )}

      {!running && run && (
        <details>
          <summary className="cursor-pointer">
            Last move ({run.trigger === "nightly" ? "nightly" : run.actor}, {when(run.startedAt)}): {STATUS_TEXT[run.status] ?? run.status},{" "}
            {run.moved} moved ({formatBytes(run.movedBytes)})
            {run.skippedCount > 0 && `, ${run.skippedCount} skipped`}
            {run.failedCount > 0 && <span className="text-(--down)">, {run.failedCount} failed</span>}
            {run.done < run.total && `, ${run.total - run.done} not reached`}
          </summary>
          {run.failed.length + run.skipped.length > 0 ? (
            <ul className="text-muted mt-2 flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              {run.failed.map((s) => (
                <li key={`f-${s.name}`} className="truncate text-(--down)">{s.name}: {s.reason}</li>
              ))}
              {run.skipped.map((s) => (
                <li key={`s-${s.name}`} className="truncate">{s.name}: {s.reason}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted mt-2">Nothing was skipped.</p>
          )}
        </details>
      )}

      {mode !== "inside" && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={nightly.enabled}
              onChange={(e) => setDraft({ ...nightly, enabled: e.target.checked })}
            />
            Every night at
          </label>
          <select
            aria-label="Hour"
            className="field"
            value={nightly.hour}
            onChange={(e) => setDraft({ ...nightly, hour: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>{hourLabel(hour)}</option>
            ))}
          </select>
          {changed && (
            <button type="button" className="btn-quiet" disabled={pending} onClick={() => act(() => saveNightly(nightly), () => setDraft(null))}>
              Save
            </button>
          )}
          <span className="text-muted">
            sort loose photo/video files into months, then move everything at the top of uploaded media. Stops
            starting new files after 6 hours; the rest go the next night.
          </span>
        </div>
      )}

      {message.error && <p role="alert" className="text-(--down)">{message.error}</p>}
      {message.done && <p className="text-(--up)">{message.done}</p>}

      <ConfirmDialog
        open={askAll}
        title="Move everything here to Photos and Videos?"
        confirmLabel={plan ? `Move ${plan.photos + plan.videos} files` : "Move"}
        busy={pending || !plan || plan.photos + plan.videos === 0}
        onCancel={() => setAskAll(false)}
        onConfirm={() => act(organizeAll)}
      >
        {plan && (
          <>
            <p>
              <strong>{plan.photos}</strong> photos and <strong>{plan.videos}</strong> videos from the top of this folder,{" "}
              {formatBytes(plan.bytes)} into {plan.months} month folders (made if missing). Subfolders (Screenshots,
              Download, …) are left alone.
            </p>
            <p className="text-muted">
              This can take hours for a big backlog. It runs in the background and can be stopped; nothing is overwritten.
            </p>
            {plan.skipped.filter((s) => s.reason !== "folder").length > 0 && (
              <p className="text-muted">
                {plan.skipped.filter((s) => s.reason !== "folder").length} other files (documents, …) stay here.
              </p>
            )}
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={askTidy}
        title="Sort photo and video into month folders?"
        confirmLabel={tidyPlan && "move" in tidyPlan ? `Sort ${tidyPlan.move} files` : "Sort"}
        busy={pending || !tidyPlan || !("move" in tidyPlan) || tidyPlan.move === 0}
        onCancel={() => setAskTidy(false)}
        onConfirm={() => act(tidyAll)}
      >
        {!tidyPlan && <p className="text-muted">Reading the year folders…</p>}
        {tidyPlan && "error" in tidyPlan && <p role="alert" className="text-(--down)">{tidyPlan.error}</p>}
        {tidyPlan && "move" in tidyPlan && (
          <>
            <ul>
              {tidyPlan.shares.map((s) => (
                <li key={s.share}>
                  <strong>{s.share}</strong>: {s.files} files ({formatBytes(s.bytes)}) into their month folders
                </li>
              ))}
            </ul>
            <p className="text-muted">
              Each stays in the year it&apos;s in. Nothing is overwritten, and named folders aren&apos;t touched.
            </p>
            {tidyPlan.stay > 0 && (
              <details>
                <summary className="cursor-pointer">
                  {tidyPlan.stay} stay in their year folder (their date is in another year, or unknown)
                </summary>
                <ul className="text-muted mt-1 flex flex-col gap-0.5">
                  {tidyPlan.samples.map((s) => (
                    <li key={s.name} className="truncate">{s.name}: {s.reason}</li>
                  ))}
                  {tidyPlan.stay > tidyPlan.samples.length && <li>…and {tidyPlan.stay - tidyPlan.samples.length} more</li>}
                </ul>
              </details>
            )}
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
