// Backup of the main router drive's photo, video and music shares to the second drive
// (Files page). Each share is copied to a folder of the same name in MIRROR_TARGET (default
// "media-backup", a shared folder on the backup drive):
//   photo -> media-backup/photo, video -> media-backup/video, music -> media-backup/music
//
// A run copies what's new or changed (rclone compares size and time, so only differences
// move). Then it compares the two drives:
// - A file on the backup at a path the main drive doesn't have, whose name and size match a
//   main-drive file that is already backed up in its own folder, is an old copy of a file that
//   was moved (the organizer files photos into month folders). It's deleted from the backup,
//   so the backup keeps one copy, in the same folder as on the main drive.
// - Anything else on the backup only is listed in mirror_pending and never deleted on its own.
//   An admin reviews it on the Files page and either copies it back to the main drive (same
//   folder) or deletes it from the backup.
// When the list is empty, both drives hold the same files in the same folders.
//
// When: right after the organizer finishes a run that moved files (uploads -> photo/video),
// and once a night at the organizer's hour even if nothing was uploaded (changes made from
// Windows), plus Run now. The copy itself runs in the hub pod's rclone container.

import { recordAudit, sql } from "./db";
import { FilesError, rc } from "./files";
import { getNightly } from "./organizer";

export function mirrorConfig(env: Record<string, string | undefined> = process.env) {
  return {
    target: env.MIRROR_TARGET ?? "media-backup",
    shares: (env.MIRROR_SHARES ?? "photo,video,music").split(",").map((s) => s.trim()).filter(Boolean),
    // How the router names the two USB drives, for messages.
    mainDrive: env.MIRROR_MAIN_DRIVE ?? "usbshare1",
    backupDrive: env.MIRROR_BACKUP_DRIVE ?? "usbshare2",
  };
}

// Never copied or compared: SRM's recycle bins and thumbnails, the hub's own Trash, Windows clutter.
export const EXCLUDE = ["#recycle/**", "@eaDir/**", "@*/**", ".hub-trash/**", "desktop.ini", "Thumbs.db", ".DS_Store"];

export function excluded(path: string) {
  const top = path.split("/")[0];
  const name = path.split("/").at(-1) ?? "";
  return top === "#recycle" || top.startsWith("@") || top.toLowerCase() === ".hub-trash" || path.includes("/@eaDir/") ||
    ["desktop.ini", "thumbs.db", ".ds_store"].includes(name.toLowerCase());
}

const fileName = (path: string) => (path.split("/").at(-1) ?? "").toLowerCase();

// Sorts the backup's files that the main drive doesn't have at the same path:
//   moved:  same name and size as a main-drive file whose own backup copy (same folder) is
//           already there with that size, so this one is a spare copy and safe to delete
//   review: everything else (really gone from the main drive, or a different version)
export function compareDrives(main: Map<string, number>, backup: Map<string, number>) {
  const byName = new Map<string, { path: string; size: number }[]>();
  for (const [path, size] of main) {
    const list = byName.get(fileName(path)) ?? [];
    list.push({ path, size });
    byName.set(fileName(path), list);
  }
  const moved: string[] = [];
  const review: { path: string; size: number }[] = [];
  for (const [path, size] of backup) {
    if (main.has(path) || excluded(path)) continue;
    const twin = (byName.get(fileName(path)) ?? []).some((m) => m.size === size && backup.get(m.path) === size);
    if (twin) moved.push(path);
    else review.push({ path, size });
  }
  const order = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  return { moved: moved.sort(order), review: review.sort((a, b) => order(a.path, b.path)) };
}

// --- Settings ----------------------------------------------------------------------------------

export async function mirrorEnabled(): Promise<boolean> {
  const [row] = await sql<{ value: { enabled?: boolean } }[]>`select value from settings where key = 'mirror'`;
  return Boolean(row?.value?.enabled);
}

export async function setMirrorEnabled(enabled: boolean) {
  await sql`
    insert into settings (key, value) values ('mirror', ${sql.json({ enabled: Boolean(enabled) })})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

// --- Runs --------------------------------------------------------------------------------------

export type MirrorStatus = "running" | "stopping" | "done" | "failed" | "stopped" | "interrupted";
// tidied: spare copies of moved files removed from the backup (see compareDrives).
export type ShareResult = {
  share: string; copied: number; bytes: number; errors: number; error?: string; pending: number; tidied?: number;
};
export type MirrorRun = {
  id: number; trigger: string; actor: string; status: MirrorStatus;
  copied: number; copiedBytes: number; errors: number;
  shares: ShareResult[]; current: string | null;
  progress: { bytes: number; totalBytes: number; transfers: number; totalTransfers: number; eta: number | null } | null;
  startedAt: Date; finishedAt: Date | null;
};

// again: the organizer sorted new files while a run was going (that run may have listed the
// shares before they arrived), so another run starts when this one ends.
type State = { active: MirrorRun | null; stopRequested: boolean; jobid: number | null; again: boolean };
const state: State = ((globalThis as { __hubMirror?: State }).__hubMirror ??= { active: null, stopRequested: false, jobid: null, again: false });

type Row = { id: number; trigger: string; actor: string; status: MirrorStatus; copied: number; copiedBytes: number; errors: number;
  detail: { shares?: ShareResult[] } | null; startedAt: Date; finishedAt: Date | null };

async function lastRun(): Promise<MirrorRun | null> {
  const [row] = await sql<Row[]>`
    select id, trigger, actor, status, copied, copied_bytes::float8 as "copiedBytes", errors, detail,
      started_at as "startedAt", finished_at as "finishedAt"
    from mirror_runs order by id desc limit 1
  `;
  if (!row) return null;
  return { ...row, shares: row.detail?.shares ?? [], current: null, progress: null };
}

export type Pending = { share: string; path: string; size: number; foundAt: Date };

export async function listPending(): Promise<Pending[]> {
  return sql<Pending[]>`
    select share, path, size::float8 as size, found_at as "foundAt" from mirror_pending order by share, path
  `;
}

export async function mirrorStatus() {
  const [run, enabled, pending] = await Promise.all([state.active ? Promise.resolve({ ...state.active }) : lastRun(), mirrorEnabled(), listPending()]);
  return { run, enabled, pending, config: mirrorConfig() };
}

// Runs left "running" by a restart are marked so, and any copy still going in rclone stopped.
export async function markInterrupted() {
  await sql`update mirror_runs set status = 'interrupted', finished_at = now() where status in ('running', 'stopping')`;
  const jobs = await rc<{ jobids?: number[] }>("job/list", {}).catch(() => ({ jobids: [] as number[] }));
  for (const jobid of jobs.jobids ?? []) {
    const job = await rc<{ finished: boolean; group?: string }>("job/status", { jobid }).catch(() => null);
    if (job && !job.finished && job.group?.startsWith("mirror/")) await rc("job/stop", { jobid }).catch(() => {});
  }
}

async function save(run: MirrorRun, final = false) {
  await sql`
    update mirror_runs set status = ${run.status}, copied = ${run.copied}, copied_bytes = ${run.copiedBytes},
      errors = ${run.errors}, detail = ${sql.json({ shares: run.shares })}, finished_at = ${final ? new Date() : null}
    where id = ${run.id}
  `;
}

type Stats = { bytes?: number; totalBytes?: number; transfers?: number; totalTransfers?: number; errors?: number; eta?: number | null };

// One share: copy main -> backup as an rclone background job, following its progress.
async function copyShare(run: MirrorRun, share: string, target: string): Promise<ShareResult> {
  const group = `mirror/${run.id}/${share}`;
  const { jobid } = await rc<{ jobid: number }>("sync/copy", {
    srcFs: `router:${share}`,
    dstFs: `router:${target}/${share}`,
    createEmptySrcDirs: true,
    _async: true,
    _group: group,
    _filter: { ExcludeRule: EXCLUDE },
    // Two files at a time: the router's CPU serves both drives, and the family still uses it.
    _config: { Transfers: 2, Checkers: 4 },
  });
  state.jobid = jobid;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 3000));
      const stats = await rc<Stats>("core/stats", { group }).catch(() => null);
      if (stats) {
        run.progress = {
          bytes: stats.bytes ?? 0, totalBytes: stats.totalBytes ?? 0,
          transfers: stats.transfers ?? 0, totalTransfers: stats.totalTransfers ?? 0, eta: stats.eta ?? null,
        };
      }
      const job = await rc<{ finished: boolean; success: boolean; error: string }>("job/status", { jobid });
      if (job.finished) {
        const final = await rc<Stats>("core/stats", { group }).catch(() => ({} as Stats));
        return {
          share, copied: final.transfers ?? 0, bytes: final.bytes ?? 0, errors: final.errors ?? 0, pending: 0,
          ...(job.success ? {} : { error: state.stopRequested ? "stopped" : job.error || "The copy didn't finish." }),
        };
      }
      if (state.stopRequested) await rc("job/stop", { jobid }).catch(() => {});
    }
  } finally {
    state.jobid = null;
    await rc("core/stats-delete", { group }).catch(() => {});
  }
}

type Listed = { Path: string; Size: number; IsDir: boolean };

async function allFiles(fs: string): Promise<Map<string, number>> {
  const data = await rc<{ list: Listed[] }>("operations/list", {
    fs, remote: "", opt: { recurse: true, filesOnly: true, noMimeType: true, noModTime: true },
  }, 30 * 60_000);
  return new Map((data.list ?? []).filter((i) => !i.IsDir).map((i) => [i.Path, Math.max(0, i.Size)]));
}

// After a copy: spare copies of moved files are removed from the backup, and what's left on
// the backup only becomes the review list for that share (replacing the last one).
async function compareShare(share: string, target: string): Promise<{ pending: number; tidied: number }> {
  const [main, backup] = await Promise.all([allFiles(`router:${share}`), allFiles(`router:${target}/${share}`)]);
  const { moved, review } = compareDrives(main, backup);
  let tidied = 0;
  for (const path of moved) {
    if (state.stopRequested) break;
    try {
      await rc("operations/deletefile", { fs: `router:${target}/${share}`, remote: path });
      tidied++;
    } catch (error) {
      if (error instanceof FilesError && error.status === 404) continue;
      review.push({ path, size: backup.get(path) ?? 0 }); // couldn't remove it: list it rather than lose track
    }
  }
  await sql.begin(async (tx) => {
    await tx`delete from mirror_pending where share = ${share}`;
    for (let i = 0; i < review.length; i += 500) {
      const rows = review.slice(i, i + 500).map((r) => ({ share, path: r.path, size: r.size }));
      await tx`insert into mirror_pending ${tx(rows, "share", "path", "size")}`;
    }
  });
  if (tidied) {
    await recordAudit("hub", "files.backup-tidied", `${target}/${share}`, { removed: tidied, files: moved.slice(0, 200) }).catch(() => {});
  }
  return { pending: review.length, tidied };
}

async function work(run: MirrorRun) {
  const { target, shares } = mirrorConfig();
  try {
    for (const share of shares) {
      if (state.stopRequested) break;
      run.current = share;
      run.progress = null;
      let result: ShareResult;
      try {
        result = await copyShare(run, share, target);
        // Only a complete copy says what's missing from the main drive.
        if (!result.error) Object.assign(result, await compareShare(share, target));
      } catch (error) {
        result = { share, copied: 0, bytes: 0, errors: 1, pending: 0, error: error instanceof Error ? error.message : "failed" };
      }
      run.shares.push(result);
      run.copied += result.copied;
      run.copiedBytes += result.bytes;
      run.errors += result.errors + (result.error && result.error !== "stopped" && !result.errors ? 1 : 0);
      await save(run).catch(() => {});
    }
    run.status = state.stopRequested ? "stopped" : run.shares.some((s) => s.error) ? "failed" : "done";
  } catch (error) {
    console.error("Backup run failed", error);
    run.status = "failed";
  } finally {
    run.current = null;
    run.progress = null;
    run.finishedAt = new Date();
    await save(run, true).catch((error) => console.error("Backup: couldn't save run %s", run.id, error));
    const stopped = state.stopRequested;
    state.active = null;
    state.stopRequested = false;
    await recordAudit(run.actor, "files.backup-finished", `run ${run.id}`, {
      trigger: run.trigger, status: run.status, copied: run.copied, bytes: run.copiedBytes, errors: run.errors,
    }).catch(() => {});
    if (state.again) {
      state.again = false;
      if (!stopped && (await mirrorEnabled().catch(() => false))) {
        await startMirror("hub", "after-organize").catch((error) => console.error("Backup: couldn't start the follow-up run", error));
      }
    }
  }
}

export async function startMirror(actor: string, trigger: "manual" | "nightly" | "after-organize"): Promise<MirrorRun> {
  if (state.active) throw new FilesError("A backup is already running.", 409);
  const [{ id, startedAt }] = await sql<{ id: number; startedAt: Date }[]>`
    insert into mirror_runs (trigger, actor, status) values (${trigger}, ${actor}, 'running')
    returning id, started_at as "startedAt"
  `;
  const run: MirrorRun = {
    id, trigger, actor, status: "running", copied: 0, copiedBytes: 0, errors: 0, shares: [], current: null, progress: null,
    startedAt, finishedAt: null,
  };
  state.active = run;
  state.stopRequested = false;
  void work(run);
  return { ...run };
}

export function stopMirror() {
  if (!state.active) return false;
  state.stopRequested = true;
  state.active.status = "stopping";
  return true;
}

// The organizer calls this when a run ends: new photos and videos go to the backup right away.
export async function afterOrganize(moved: number) {
  if (moved <= 0 || !(await mirrorEnabled())) return;
  if (state.active) {
    state.again = true; // started when the current run ends
    return;
  }
  await startMirror("hub", "after-organize");
}

// Called every few minutes: once a night, in the organizer's hour (New York time), when the
// organizer isn't busy. If the organizer moved files tonight, afterOrganize already ran it.
export async function nightlyTick(organizerBusy: boolean, now = new Date()) {
  if (state.active || organizerBusy || !(await mirrorEnabled())) return null;
  const { hour } = await getNightly();
  const current = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(now));
  if (current !== hour) return null;
  const [recent] = await sql`select 1 from mirror_runs where started_at > ${new Date(now.getTime() - 20 * 3600_000)} and trigger <> 'manual'`;
  if (recent) return null;
  return startMirror("hub", "nightly");
}

// --- Confirmed deletions -----------------------------------------------------------------------

// Whether the main drive has the file (a missing folder counts as missing; other errors throw).
async function onMain(share: string, path: string) {
  try {
    const result = await rc<{ item: unknown }>("operations/stat", { fs: `router:${share}`, remote: path });
    return Boolean(result.item);
  } catch (error) {
    if (error instanceof FilesError && error.status === 404) return false;
    throw error;
  }
}

// Deletes the chosen files from the backup, but only ones still missing from the main drive
// (one put back since the last run is kept and dropped from the list).
export async function deleteFromBackup(items: { share: string; path: string }[]): Promise<{ deleted: number; kept: number; failed: number }> {
  const { target, shares } = mirrorConfig();
  let deleted = 0, kept = 0, failed = 0;
  for (const { share, path } of items) {
    if (!shares.includes(share) || !path || path.split("/").some((p) => p === ".." || p === "") || excluded(path)) continue;
    const [row] = await sql`select 1 from mirror_pending where share = ${share} and path = ${path}`;
    if (!row) continue;
    try {
      if (await onMain(share, path)) {
        kept++;
      } else {
        try {
          await rc("operations/deletefile", { fs: `router:${target}/${share}`, remote: path });
        } catch (error) {
          if (!(error instanceof FilesError && error.status === 404)) throw error; // already gone is fine
        }
        deleted++;
      }
      await sql`delete from mirror_pending where share = ${share} and path = ${path}`;
    } catch {
      failed++;
    }
  }
  return { deleted, kept, failed };
}

// Copies the chosen files from the backup back to the main drive, into the same folder. One the
// main drive has again since the last run is left alone (never overwritten).
export async function copyBackToMain(items: { share: string; path: string }[]): Promise<{ copied: number; kept: number; failed: number }> {
  const { target, shares } = mirrorConfig();
  let copied = 0, kept = 0, failed = 0;
  for (const { share, path } of items) {
    if (!shares.includes(share) || !path || path.split("/").some((p) => p === ".." || p === "") || excluded(path)) continue;
    const [row] = await sql`select 1 from mirror_pending where share = ${share} and path = ${path}`;
    if (!row) continue;
    try {
      if (await onMain(share, path)) {
        kept++;
      } else {
        await rc("operations/copyfile", { srcFs: `router:${target}/${share}`, srcRemote: path, dstFs: `router:${share}`, dstRemote: path });
        copied++;
      }
      await sql`delete from mirror_pending where share = ${share} and path = ${path}`;
    } catch {
      failed++;
    }
  }
  return { copied, kept, failed };
}
