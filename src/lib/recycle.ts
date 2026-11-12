// SRM recycle bins (Manage > Trash). Each router share can keep its own bin, <share>/#recycle,
// where anything deleted over SMB (Windows, apps) waits at its original path until someone
// empties it. SRM shows neither its size nor its contents. The bins were switched off on
// 2026-11-12, so they only shrink now, but they still held about 150 GB.
//
// Measuring a bin means listing every file in it (a few seconds per share), so it's done in the
// background every few hours (src/instrumentation.ts) and the result kept in the settings
// table; the Trash page only reads that. Opening a bin reads one folder of it at a time, live.

import { sql } from "./db";
import {
  assertShare, deleteEntry, exists, FilesError, listFolder, listShares, makeFolder, parentOf, rc, rename,
  type Entry, type FilePath,
} from "./files";

export const RECYCLE = "#recycle";
const KEY = "recycle-bins";

export type Bin = { share: string; bytes: number; files: number; error?: string };
export type BinSummary = { checkedAt: string | null; bins: Bin[] };

// A path inside a share's bin: ("photo", ["2024", "a.jpg"]) -> photo/#recycle/2024/a.jpg
export function inBin(share: string, parts: string[]): FilePath {
  return { share, parts: [RECYCLE, ...parts] };
}

// Bins with something in them first, biggest first; then the empty ones by name.
export function sortBins(bins: Bin[]): Bin[] {
  return [...bins].sort((a, b) => b.bytes - a.bytes || b.files - a.files || a.share.localeCompare(b.share));
}

// Replaces one share's row in a summary (after a delete or empty), keeping the others.
export function withBin(summary: BinSummary, bin: Bin): BinSummary {
  return { ...summary, bins: sortBins([...summary.bins.filter((b) => b.share !== bin.share), bin]) };
}

export async function readBins(): Promise<BinSummary> {
  const [row] = await sql<{ value: BinSummary }[]>`select value from settings where key = ${KEY}`;
  return row?.value ?? { checkedAt: null, bins: [] };
}

async function saveBins(summary: BinSummary) {
  await sql`
    insert into settings (key, value) values (${KEY}, ${sql.json(summary)})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

async function measure(share: string): Promise<Bin> {
  try {
    // A big bin is thousands of files over SMB: allow up to 5 minutes.
    const size = await rc<{ bytes?: number; count?: number }>("operations/size", { fs: `router:${share}/${RECYCLE}` }, 300_000);
    return { share, bytes: Math.max(0, size.bytes ?? 0), files: Math.max(0, size.count ?? 0) };
  } catch (error) {
    if (error instanceof FilesError && error.status === 404) return { share, bytes: 0, files: 0 }; // no bin
    return { share, bytes: 0, files: 0, error: error instanceof FilesError ? error.message : "Couldn't measure it." };
  }
}

// Every share the hub can open, measured one after another (the router is a small box).
export async function scanBins(): Promise<BinSummary> {
  const bins: Bin[] = [];
  for (const share of await listShares()) bins.push(await measure(share.name));
  const summary = { checkedAt: new Date().toISOString(), bins: sortBins(bins) };
  await saveBins(summary);
  return summary;
}

async function rescan(share: string) {
  await saveBins(withBin(await readBins(), await measure(share)));
}

// One level of a bin, like a folder in Files.
export async function listBin(share: string, parts: string[]): Promise<Entry[]> {
  await assertShare(share);
  return listFolder(inBin(share, parts));
}

// Moves an item back to where it was deleted from (making its folder again if needed).
export async function restoreFromBin(share: string, parts: string[]) {
  if (parts.length === 0) throw new FilesError("Pick something in the bin.", 400);
  await assertShare(share);
  const to: FilePath = { share, parts };
  if (await exists(to)) throw new FilesError(`Something named ${parts.at(-1)} is already back in that folder. Rename or move it first.`, 409);
  if (parts.length > 1) await makeFolder(parentOf(to));
  await rename(inBin(share, parts), to);
  await rescan(share);
}

export async function deleteFromBin(share: string, parts: string[], isDir: boolean) {
  if (parts.length === 0) throw new FilesError("Pick something in the bin.", 400);
  await assertShare(share);
  await deleteEntry(inBin(share, parts), isDir);
  await rescan(share);
}

export async function emptyBin(share: string) {
  await assertShare(share);
  try {
    await deleteEntry(inBin(share, []), true);
  } catch (error) {
    if (!(error instanceof FilesError && error.status === 404)) throw error; // already empty
  }
  await rescan(share);
}
