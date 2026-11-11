// Moves photos and videos out of the phone's upload folder (Public_WD/uploaded media) into
// photo/<year>/<year-month>/ and video/<year>/<year-month>/ on the router. Started by an admin
// for chosen files, or nightly for everything at the top of the upload folder.
//
// Photos, videos and Public_WD are separate shares, so each move is a copy then delete through
// the rclone sidecar (rclone checks the copy's size before deleting the original). Big videos
// take minutes, so a run works in the background, one file at a time, and can be stopped
// between files. Nothing is ever overwritten: a file whose name is already taken at the
// destination stays where it is and is listed as skipped.

import { recordAudit, sql } from "./db";
import { FilesError, joinPath, makeFolder, parentOf, rc, type FilePath } from "./files";
import { destination, inSource, mediaKind, monthFolder, organizeConfig, takenMonth } from "./media";

export type Trigger = "manual" | "nightly";
export type RunStatus = "running" | "stopping" | "done" | "stopped" | "failed" | "interrupted";
export type Skip = { name: string; reason: string };

export type Run = {
  id: number;
  trigger: Trigger;
  actor: string;
  status: RunStatus;
  total: number;
  done: number;
  moved: number;
  movedBytes: number;
  skipped: Skip[];
  failed: Skip[];
  skippedCount: number;
  failedCount: number;
  current: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type Nightly = { enabled: boolean; hour: number };

const NIGHTLY_HOURS = 6; // a nightly run starts no new file after this long
const LIST_LIMIT = 300; // skipped/failed names kept per run

// Kept on globalThis: Next loads this module separately for instrumentation.ts (nightly runs)
// and for server actions, and both must see the same run.
type State = { active: Run | null; stopRequested: boolean };
const state: State = ((globalThis as { __hubOrganizer?: State }).__hubOrganizer ??= { active: null, stopRequested: false });

// --- Settings ----------------------------------------------------------------------------------

export async function getNightly(): Promise<Nightly> {
  const [row] = await sql<{ value: Nightly }[]>`select value from settings where key = 'organize.nightly'`;
  const value = row?.value;
  return { enabled: Boolean(value?.enabled), hour: Number.isInteger(value?.hour) ? value!.hour : 1 };
}

export async function setNightly(value: Nightly) {
  const clean = { enabled: Boolean(value.enabled), hour: Math.min(23, Math.max(0, Math.floor(Number(value.hour) || 0))) };
  await sql`
    insert into settings (key, value) values ('organize.nightly', ${sql.json(clean)})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  return clean;
}

// --- Status ------------------------------------------------------------------------------------

type Detail = { skipped?: Skip[]; failed?: Skip[]; done?: number; skippedCount?: number; failedCount?: number };
type RunRow = Omit<Run, "skipped" | "failed" | "skippedCount" | "failedCount" | "current" | "done"> & { detail: Detail | null };

async function lastRun(): Promise<Run | null> {
  const [row] = await sql<RunRow[]>`
    select id, trigger, actor, status, total, moved, moved_bytes::float8 as "movedBytes",
           detail, started_at as "startedAt", finished_at as "finishedAt"
    from organize_runs order by id desc limit 1
  `;
  if (!row) return null;
  const { detail, ...rest } = row;
  const skipped = detail?.skipped ?? [];
  const failed = detail?.failed ?? [];
  return {
    ...rest, done: detail?.done ?? rest.total, skipped, failed, current: null,
    skippedCount: detail?.skippedCount ?? skipped.length, failedCount: detail?.failedCount ?? failed.length,
  };
}

export async function organizerStatus(): Promise<{ run: Run | null; nightly: Nightly }> {
  return { run: state.active ? { ...state.active } : await lastRun(), nightly: await getNightly() };
}

// A run that was going when the hub restarted is marked as cut short.
export async function markInterrupted() {
  await sql`update organize_runs set status = 'interrupted', finished_at = now() where status in ('running', 'stopping')`;
}

export function stopOrganize() {
  if (!state.active || state.active.status !== "running") return false;
  state.stopRequested = true;
  state.active.status = "stopping";
  return true;
}

export async function auditFinished(run: Run) {
  await recordAudit(run.actor, "files.organize-finished", `run ${run.id}`, {
    trigger: run.trigger, status: run.status, moved: run.moved, bytes: run.movedBytes,
    skipped: run.skippedCount, failed: run.failedCount,
  });
}

// --- Running -----------------------------------------------------------------------------------

type Stat = { item: { Size?: number; ModTime?: string; IsDir?: boolean } | null };

async function stat(path: FilePath) {
  return (await rc<Stat>("operations/stat", { fs: `router:${path.share}`, remote: path.parts.join("/") })).item;
}

async function waitForJob(jobid: number, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const job = await rc<{ finished: boolean; success: boolean; error: string }>("job/status", { jobid });
    if (job.finished) {
      if (!job.success) throw new FilesError(job.error || "The move didn't finish.");
      return;
    }
    if (Date.now() > until) {
      await rc("job/stop", { jobid }).catch(() => {});
      throw new FilesError("The move took too long and was stopped.");
    }
  }
}

// One file: the bytes moved, or why it wasn't moved.
async function moveOne(from: FilePath, madeFolders: Set<string>): Promise<{ skip?: string; fail?: string; bytes?: number }> {
  const config = organizeConfig();
  const name = from.parts.at(-1)!;
  const kind = mediaKind(name);
  if (!kind) return { skip: "not a JPG, PNG, MP4 or AVI" };
  const source = await stat(from);
  if (!source || source.IsDir) return { skip: "no longer there" };
  const date = takenMonth(name, source.ModTime ?? null);
  if (!date) return { skip: "no date" };
  const to = destination(name, kind, date, config);
  const there = await stat(to);
  if (there) {
    return {
      skip: there.Size === source.Size
        ? `already in ${to.share}/${date.year}/${monthFolder(date)} (same size), left here`
        : `a different file with this name is in ${to.share}/${date.year}/${monthFolder(date)}`,
    };
  }
  const folder = joinPath(parentOf(to));
  if (!madeFolders.has(folder)) {
    await makeFolder(parentOf(to));
    madeFolders.add(folder);
  }
  const size = Math.max(0, source.Size ?? 0);
  const { jobid } = await rc<{ jobid: number }>("operations/movefile", {
    srcFs: `router:${from.share}`, srcRemote: from.parts.join("/"),
    dstFs: `router:${to.share}`, dstRemote: to.parts.join("/"),
    _async: true,
  });
  await waitForJob(jobid, 10 * 60_000 + (size / (2 * 1024 * 1024)) * 1000); // at least 2 MB/s
  const arrived = await stat(to);
  if (!arrived || arrived.Size !== source.Size) return { fail: "the copy at the destination doesn't match; the original was kept" };
  return { bytes: size };
}

async function save(run: Run, final = false) {
  const detail: Detail = { skipped: run.skipped, failed: run.failed, done: run.done, skippedCount: run.skippedCount, failedCount: run.failedCount };
  await sql`
    update organize_runs set status = ${run.status}, total = ${run.total}, moved = ${run.moved},
      moved_bytes = ${run.movedBytes}, detail = ${sql.json(detail)}, finished_at = ${final ? new Date() : null}
    where id = ${run.id}
  `;
}

function note(run: Run, list: "skipped" | "failed", name: string, reason: string) {
  if (list === "skipped") run.skippedCount++;
  else run.failedCount++;
  if (run[list].length < LIST_LIMIT) run[list].push({ name, reason });
}

async function work(run: Run, files: FilePath[], deadline: number | null, onFinish: (run: Run) => Promise<void>) {
  const madeFolders = new Set<string>();
  try {
    for (const file of files) {
      if (state.stopRequested || (deadline && Date.now() > deadline)) break;
      const name = file.parts.at(-1)!;
      run.current = name;
      try {
        const result = await moveOne(file, madeFolders);
        if (result.skip) note(run, "skipped", name, result.skip);
        else if (result.fail) note(run, "failed", name, result.fail);
        else {
          run.moved++;
          run.movedBytes += result.bytes ?? 0;
        }
      } catch (error) {
        note(run, "failed", name, error instanceof Error ? error.message : "failed");
      }
      run.done++;
      if (run.done % 25 === 0) await save(run).catch(() => {});
    }
    run.status = state.stopRequested ? "stopped" : run.done < run.total ? "stopped" : "done";
  } catch (error) {
    console.error("Organizer run failed", error);
    run.status = "failed";
  } finally {
    run.current = null;
    run.finishedAt = new Date();
    await save(run, true).catch((error) => console.error("Organizer: couldn't save run %s", run.id, error));
    state.active = null;
    state.stopRequested = false;
    await onFinish(run).catch(() => {});
  }
}

// Files at the top of the upload folder that the organizer would move (the nightly list).
export async function sourceFiles(): Promise<FilePath[]> {
  const { source } = organizeConfig();
  const data = await rc<{ list: { Name: string; IsDir: boolean }[] }>("operations/list", {
    fs: `router:${source.share}`, remote: source.parts.join("/"), opt: { filesOnly: true, noMimeType: true, noModTime: true },
  });
  return (data.list ?? [])
    .filter((i) => !i.IsDir && mediaKind(i.Name))
    .map((i) => ({ share: source.share, parts: [...source.parts, i.Name] }))
    .sort((a, b) => a.parts.at(-1)!.localeCompare(b.parts.at(-1)!, undefined, { numeric: true }));
}

// Starts a run in the background; returns at once. Only files inside the upload folder move.
export async function startOrganize(
  files: FilePath[], actor: string, trigger: Trigger, onFinish: (run: Run) => Promise<void> = auditFinished,
): Promise<Run> {
  if (state.active) throw new FilesError("A move is already running.", 409);
  const config = organizeConfig();
  const allowed = files.filter((f) => f.parts.length > config.source.parts.length && inSource(parentOf(f), config) && mediaKind(f.parts.at(-1)!));
  if (allowed.length === 0) throw new FilesError("None of those are JPG, PNG, MP4 or AVI files in the upload folder.", 400);
  const [{ id, startedAt }] = await sql<{ id: number; startedAt: Date }[]>`
    insert into organize_runs (trigger, actor, status, total) values (${trigger}, ${actor}, 'running', ${allowed.length})
    returning id, started_at as "startedAt"
  `;
  const run: Run = {
    id, trigger, actor, status: "running", total: allowed.length, done: 0, moved: 0, movedBytes: 0,
    skipped: [], failed: [], skippedCount: 0, failedCount: 0, current: null, startedAt, finishedAt: null,
  };
  state.active = run;
  state.stopRequested = false;
  const deadline = trigger === "nightly" ? Date.now() + NIGHTLY_HOURS * 3600_000 : null;
  void work(run, allowed, deadline, onFinish);
  return { ...run };
}

// Called every few minutes: starts the nightly run once a day in its hour (New York time).
export async function nightlyTick(now = new Date()) {
  if (state.active) return null;
  const nightly = await getNightly();
  if (!nightly.enabled) return null;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour !== nightly.hour) return null;
  const [recent] = await sql`select 1 from organize_runs where trigger = 'nightly' and started_at > ${new Date(now.getTime() - 20 * 3600_000)}`;
  if (recent) return null;
  const files = await sourceFiles();
  if (files.length === 0) return null;
  return startOrganize(files, "hub", "nightly");
}
