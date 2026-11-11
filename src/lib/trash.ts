// The hub's Trash for router files. SRM has no recycle bin for shared folders, so a delete in
// the Files page moves the item to <share>/.hub-trash/<id>/<name> (an in-place move on the
// router, instant even for big folders) and records it in the file_trash table. Admins can
// restore it or delete it for good from Manage > Trash; anything older than TRASH_DAYS
// (default 30) is deleted for good by an hourly sweep (src/instrumentation.ts).

import { randomBytes } from "node:crypto";
import { sql } from "./db";
import {
  deleteEntry, exists, fileSize, FilesError, joinPath, makeFolder, parentOf, removeEmptyFolder, rename, TRASH_FOLDER,
  type FilePath,
} from "./files";

export function trashDays() {
  const days = Number(process.env.TRASH_DAYS ?? 30);
  return Number.isFinite(days) && days >= 1 ? Math.floor(days) : 30;
}

export function expiresAt(deletedAt: Date, days = trashDays()) {
  return new Date(deletedAt.getTime() + days * 24 * 3600 * 1000);
}

export const TRASH_ID = /^\d{13}-[a-f0-9]{8}$/;

export function newTrashId(now = Date.now()) {
  return `${now}-${randomBytes(4).toString("hex")}`;
}

export type TrashItem = {
  id: string;
  share: string;
  original: string; // path inside the share, "folder/name.jpg"
  isDir: boolean;
  size: number;
  deletedBy: string;
  deletedAt: Date;
};

const holder = (item: { id: string; share: string }): FilePath => ({ share: item.share, parts: [TRASH_FOLDER, item.id] });
const originalPath = (item: { share: string; original: string }): FilePath => ({ share: item.share, parts: item.original.split("/") });

export async function moveToTrash(path: FilePath, isDir: boolean, actor: string): Promise<TrashItem> {
  if (path.parts.length === 0) throw new FilesError("A whole share can't be deleted here.", 400);
  const id = newTrashId();
  const size = isDir ? 0 : await fileSize(path).catch(() => 0);
  const box = holder({ id, share: path.share });
  await makeFolder(box); // makes .hub-trash too
  await rename(path, { share: path.share, parts: [...box.parts, path.parts.at(-1)!] });
  const [row] = await sql<TrashItem[]>`
    insert into file_trash (id, share, original, is_dir, size, deleted_by)
    values (${id}, ${path.share}, ${path.parts.join("/")}, ${isDir}, ${size}, ${actor})
    returning id, share, original, is_dir as "isDir", size::float8 as size, deleted_by as "deletedBy", deleted_at as "deletedAt"
  `;
  return row;
}

export async function listTrash(): Promise<TrashItem[]> {
  return sql<TrashItem[]>`
    select id, share, original, is_dir as "isDir", size::float8 as size, deleted_by as "deletedBy", deleted_at as "deletedAt"
    from file_trash order by deleted_at desc
  `;
}

async function findTrash(id: string): Promise<TrashItem> {
  if (!TRASH_ID.test(id)) throw new FilesError("Not found.", 404);
  const [row] = await sql<TrashItem[]>`
    select id, share, original, is_dir as "isDir", size::float8 as size, deleted_by as "deletedBy", deleted_at as "deletedAt"
    from file_trash where id = ${id}
  `;
  if (!row) throw new FilesError("That's no longer in the Trash.", 404);
  return row;
}

// Puts an item back where it was (making its folder again if that was deleted since).
export async function restore(id: string): Promise<TrashItem> {
  const item = await findTrash(id);
  const to = originalPath(item);
  const name = to.parts.at(-1)!;
  if (await exists(to)) throw new FilesError(`Something named ${name} is back in that folder. Rename or move it first.`, 409);
  if (to.parts.length > 1) await makeFolder(parentOf(to));
  await rename({ share: item.share, parts: [...holder(item).parts, name] }, to);
  await removeEmptyFolder(holder(item)).catch(() => {});
  await sql`delete from file_trash where id = ${id}`;
  return item;
}

// Deletes an item for good. If its files are already gone from the router, just forgets it.
export async function deleteForever(id: string): Promise<TrashItem> {
  const item = await findTrash(id);
  try {
    await deleteEntry(holder(item), true);
  } catch (error) {
    if (!(error instanceof FilesError && error.status === 404)) throw error;
  }
  await sql`delete from file_trash where id = ${id}`;
  return item;
}

// Items older than TRASH_DAYS, deleted for good. Returns what was removed.
export async function emptyExpired(now = new Date()): Promise<TrashItem[]> {
  const cutoff = new Date(now.getTime() - trashDays() * 24 * 3600 * 1000);
  const old = await sql<{ id: string }[]>`select id from file_trash where deleted_at < ${cutoff}`;
  const removed: TrashItem[] = [];
  for (const { id } of old) {
    try {
      removed.push(await deleteForever(id));
    } catch (error) {
      console.error(`Trash: couldn't empty ${id}`, error);
    }
  }
  return removed;
}

export function describe(item: Pick<TrashItem, "share" | "original">) {
  return joinPath(originalPath(item));
}
