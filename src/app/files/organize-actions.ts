"use server";

import { requireAdmin } from "@/lib/access";
import { recordAudit } from "@/lib/db";
import { FilesError, parsePath, type FilePath } from "@/lib/files";
import {
  organizerStatus, setNightly, sourceFiles, startOrganize, stopOrganize, type Nightly, type Run,
} from "@/lib/organizer";

export type OrganizeState = { error?: string; done?: string };
export type OrganizeStatus = { run: Run | null; nightly: Nightly };

async function guard(run: () => Promise<OrganizeState>): Promise<OrganizeState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FilesError) return { error: error.message };
    if (error instanceof Error && error.message === "Admin access required") return { error: "Only admins can move files." };
    console.error("Organize action failed", error);
    return { error: "That didn't work. Try again." };
  }
}

export async function getOrganizeStatus(): Promise<OrganizeStatus | null> {
  try {
    await requireAdmin();
    return await organizerStatus();
  } catch {
    return null;
  }
}

// Moves the chosen files (paths like "Public_WD/uploaded media/20251224_222810.jpg").
export async function organizeSelected(paths: string[]): Promise<OrganizeState> {
  return guard(async () => {
    const user = await requireAdmin();
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 20_000) return { error: "Pick some files first." };
    const files = paths.map((p) => parsePath(String(p))).filter((p): p is FilePath => p !== null);
    const run = await startOrganize(files, user.name, "manual");
    await recordAudit(user.name, "files.organize-started", `run ${run.id}`, { trigger: "manual", files: run.total });
    return { done: `Moving ${run.total} file${run.total === 1 ? "" : "s"}. You can leave this page; it keeps going.` };
  });
}

// Moves every JPG/PNG/MP4/AVI at the top of the upload folder (what the nightly run does).
export async function organizeAll(): Promise<OrganizeState> {
  return guard(async () => {
    const user = await requireAdmin();
    const files = await sourceFiles();
    if (files.length === 0) return { done: "Nothing to move: no photos or videos at the top of the upload folder." };
    const run = await startOrganize(files, user.name, "manual");
    await recordAudit(user.name, "files.organize-started", `run ${run.id}`, { trigger: "manual-all", files: run.total });
    return { done: `Moving ${run.total} files. You can leave this page; it keeps going.` };
  });
}

export async function stopOrganizing(): Promise<OrganizeState> {
  return guard(async () => {
    const user = await requireAdmin();
    if (!stopOrganize()) return { error: "Nothing is moving right now." };
    await recordAudit(user.name, "files.organize-stop", "organizer");
    return { done: "Stopping after the file that's moving now." };
  });
}

export async function saveNightly(value: Nightly): Promise<OrganizeState> {
  return guard(async () => {
    const user = await requireAdmin();
    const saved = await setNightly(value);
    await recordAudit(user.name, "files.organize-nightly", "organizer", saved);
    const hour = new Date(2000, 0, 1, saved.hour).toLocaleTimeString("en-US", { hour: "numeric" });
    return { done: saved.enabled ? `Nightly moves on, starting at ${hour}.` : "Nightly moves off." };
  });
}
