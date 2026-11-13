"use server";

import { requireAdmin } from "@/lib/access";
import { recordAudit } from "@/lib/db";
import { FilesError } from "@/lib/files";
import {
  deleteFromBackup, listPending, mirrorStatus, setMirrorEnabled, startMirror, stopMirror, type MirrorRun, type Pending,
} from "@/lib/mirror";

export type MirrorState = { error?: string; done?: string };
export type MirrorView = {
  run: MirrorRun | null;
  enabled: boolean;
  pending: Pending[];
  pendingCount: number;
  pendingBytes: number;
  config: { target: string; shares: string[] };
};

// The review list shows at most this many; "Delete all" still covers every one.
const SHOWN = 2000;

async function guard(run: () => Promise<MirrorState>): Promise<MirrorState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FilesError) return { error: error.message };
    if (error instanceof Error && error.message === "Admin access required") return { error: "Only admins can manage the backup." };
    console.error("Backup action failed", error);
    return { error: "That didn't work. Try again." };
  }
}

export async function getMirrorView(): Promise<MirrorView | null> {
  try {
    await requireAdmin();
    const status = await mirrorStatus();
    return {
      run: status.run,
      enabled: status.enabled,
      pending: status.pending.slice(0, SHOWN),
      pendingCount: status.pending.length,
      pendingBytes: status.pending.reduce((n, p) => n + p.size, 0),
      config: status.config,
    };
  } catch {
    return null;
  }
}

export async function setMirror(enabled: boolean): Promise<MirrorState> {
  return guard(async () => {
    const user = await requireAdmin();
    await setMirrorEnabled(Boolean(enabled));
    await recordAudit(user.name, enabled ? "files.backup-on" : "files.backup-off", "media backup");
    return { done: enabled ? "Backup turned on." : "Backup turned off." };
  });
}

export async function runMirror(): Promise<MirrorState> {
  return guard(async () => {
    const user = await requireAdmin();
    const run = await startMirror(user.name, "manual");
    await recordAudit(user.name, "files.backup-started", `run ${run.id}`, { trigger: "manual" });
    return { done: "Backup started." };
  });
}

export async function stopMirrorRun(): Promise<MirrorState> {
  return guard(async () => {
    const user = await requireAdmin();
    if (!stopMirror()) return { error: "No backup is running." };
    await recordAudit(user.name, "files.backup-stop", "media backup");
    return { done: "Stopping after the files in progress…" };
  });
}

// items: the reviewed files, or "all" for every file on the pending list.
export async function confirmBackupDeletes(items: { share: string; path: string }[] | "all"): Promise<MirrorState> {
  return guard(async () => {
    const user = await requireAdmin();
    const chosen = items === "all"
      ? (await listPending()).map((p) => ({ share: p.share, path: p.path }))
      : Array.isArray(items) ? items.map((i) => ({ share: String(i.share), path: String(i.path) })) : [];
    if (chosen.length === 0) return { error: "Pick some files first." };
    const result = await deleteFromBackup(chosen);
    await recordAudit(user.name, "files.backup-delete", "media backup", { ...result, files: chosen.slice(0, 200).map((c) => `${c.share}/${c.path}`) });
    const parts = [`Deleted ${result.deleted} file${result.deleted === 1 ? "" : "s"} from the backup.`];
    if (result.kept) parts.push(`${result.kept} kept: back on the main drive.`);
    if (result.failed) parts.push(`${result.failed} couldn't be deleted; they stay on the list.`);
    return result.failed && !result.deleted ? { error: parts.join(" ") } : { done: parts.join(" ") };
  });
}
