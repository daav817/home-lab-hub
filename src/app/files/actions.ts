"use server";

import { requireAdmin } from "@/lib/access";
import { recordAudit } from "@/lib/db";
import {
  assertShare, cleanName, exists, FilesError, joinPath, makeFolder, parentOf, parsePath, rename,
} from "@/lib/files";
import { deleteForever, describe, listTrash, moveToTrash, restore } from "@/lib/trash";
import { deleteFromBin, emptyBin, restoreFromBin, scanBins } from "@/lib/recycle";

export type FileActionState = { error?: string; done?: string };

async function guard(run: () => Promise<FileActionState>): Promise<FileActionState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FilesError) return { error: error.message };
    if (error instanceof Error && error.message === "Admin access required") return { error: "Only admins can change files." };
    console.error("File action failed", error);
    return { error: "That didn't work. Try again." };
  }
}

export async function newFolder(folder: string, name: string): Promise<FileActionState> {
  return guard(async () => {
    const user = await requireAdmin();
    const parent = parsePath(folder);
    const clean = cleanName(name);
    if (!parent || !clean) return { error: "Folder names can't contain \\ / : * ? \" < > | or end with a dot or space." };
    await assertShare(parent.share);
    const path = { share: parent.share, parts: [...parent.parts, clean] };
    if (await exists(path)) return { error: "Something with that name is already there." };
    await makeFolder(path);
    await recordAudit(user.name, "files.mkdir", joinPath(path));
    return { done: `Made folder ${clean}.` };
  });
}

export async function renameEntry(from: string, name: string): Promise<FileActionState> {
  return guard(async () => {
    const user = await requireAdmin();
    const path = parsePath(from);
    const clean = cleanName(name);
    if (!path || path.parts.length === 0 || !clean) return { error: "Names can't contain \\ / : * ? \" < > | or end with a dot or space." };
    await assertShare(path.share);
    const to = { share: path.share, parts: [...parentOf(path).parts, clean] };
    await rename(path, to);
    await recordAudit(user.name, "files.rename", joinPath(path), { to: joinPath(to) });
    return { done: `Renamed to ${clean}.` };
  });
}

export async function deleteEntries(items: { path: string; isDir: boolean }[]): Promise<FileActionState> {
  return guard(async () => {
    const user = await requireAdmin();
    if (!Array.isArray(items) || items.length === 0 || items.length > 500) return { error: "Pick between 1 and 500 items." };
    const paths = items.map((i) => ({ path: parsePath(i.path), isDir: Boolean(i.isDir) }));
    // Never a whole share: only things inside one.
    if (paths.some((p) => !p.path || p.path.parts.length === 0)) return { error: "That can't be deleted here." };
    for (const share of new Set(paths.map((p) => p.path!.share))) await assertShare(share);
    let moved = 0;
    for (const { path, isDir } of paths) {
      const item = await moveToTrash(path!, isDir, user.name);
      await recordAudit(user.name, "files.trash", joinPath(path!), { trashId: item.id, isDir });
      moved++;
    }
    return { done: `Moved ${moved} item${moved === 1 ? "" : "s"} to the Trash.` };
  });
}

// --- Trash (Manage > Trash) ---

export async function restoreFromTrash(id: string): Promise<FileActionState> {
  return guard(async () => {
    const user = await requireAdmin();
    const item = await restore(id);
    await recordAudit(user.name, "files.restore", describe(item), { trashId: id });
    return { done: `Restored ${describe(item)}.` };
  });
}

export async function deleteFromTrash(id: string): Promise<FileActionState> {
  return guard(async () => {
    const user = await requireAdmin();
    const item = await deleteForever(id);
    await recordAudit(user.name, "files.delete-forever", describe(item), { trashId: id });
    return { done: `Deleted ${describe(item)} for good.` };
  });
}

export async function emptyTrash(): Promise<FileActionState> {
  return guard(async () => {
    const user = await requireAdmin();
    let count = 0;
    for (const item of await listTrash()) {
      await deleteForever(item.id);
      await recordAudit(user.name, "files.delete-forever", describe(item), { trashId: item.id });
      count++;
    }
    return { done: `Emptied the Trash (${count} item${count === 1 ? "" : "s"}).` };
  });
}

// --- SRM recycle bins (Manage > Trash, src/lib/recycle.ts) ---

// share + path inside its bin, checked like any Files path.
function binPath(share: string, path: string[]) {
  const parsed = Array.isArray(path) ? parsePath([String(share), ...path.map(String)]) : null;
  return parsed && !parsed.parts.includes("#recycle") ? parsed : null;
}

export async function checkBins(): Promise<FileActionState> {
  return guard(async () => {
    await requireAdmin();
    const summary = await scanBins();
    const files = summary.bins.reduce((n, b) => n + b.files, 0);
    return { done: `Checked ${summary.bins.length} share${summary.bins.length === 1 ? "" : "s"}: ${files} file${files === 1 ? "" : "s"} in recycle bins.` };
  });
}

export async function restoreBinItem(share: string, path: string[]): Promise<FileActionState> {
  return guard(async () => {
    const user = await requireAdmin();
    const item = binPath(share, path);
    if (!item || item.parts.length === 0) return { error: "That can't be restored." };
    await restoreFromBin(item.share, item.parts);
    await recordAudit(user.name, "files.recycle-restore", joinPath(item));
    return { done: `Restored ${joinPath(item)}.` };
  });
}

export async function deleteBinItem(share: string, path: string[], isDir: boolean): Promise<FileActionState> {
  return guard(async () => {
    const user = await requireAdmin();
    const item = binPath(share, path);
    if (!item || item.parts.length === 0) return { error: "That can't be deleted here." };
    await deleteFromBin(item.share, item.parts, Boolean(isDir));
    await recordAudit(user.name, "files.recycle-delete", joinPath(item), { isDir: Boolean(isDir) });
    return { done: `Deleted ${item.parts.at(-1)} for good.` };
  });
}

export async function emptyShareBin(share: string): Promise<FileActionState> {
  return guard(async () => {
    const user = await requireAdmin();
    const item = binPath(share, []);
    if (!item) return { error: "Not found." };
    await emptyBin(item.share);
    await recordAudit(user.name, "files.recycle-empty", item.share);
    return { done: `Emptied the ${item.share} recycle bin.` };
  });
}
