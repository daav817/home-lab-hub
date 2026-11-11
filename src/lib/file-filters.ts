// Search, filters and sorting for a folder listing in the Files page (all in the browser: a
// folder's whole listing is already there, even with thousands of files).

import type { Entry } from "./files";
import { fileType, monthFolder, takenMonth, type FileType } from "./media";

export type Sort = "name" | "newest" | "oldest" | "largest" | "smallest";

export type Filters = {
  query: string;
  type: "all" | "folder" | FileType;
  from: string; // "2024-01" or ""
  to: string;
  minSize: number; // bytes
  sort: Sort;
};

export const NO_FILTERS: Filters = { query: "", type: "all", from: "", to: "", minSize: 0, sort: "name" };

export function isFiltered(filters: Filters) {
  return filters.query.trim() !== "" || filters.type !== "all" || filters.from !== "" || filters.to !== "" || filters.minSize > 0;
}

// "2025-12" for a file, from its name when it has a date stamp, else its modified time.
export function entryMonth(entry: Entry): string | null {
  if (entry.isDir) return null;
  const month = takenMonth(entry.name, entry.modified);
  return month ? monthFolder(month) : null;
}

// Sortable moment: the name's stamp (20251224_222810 -> "20251224222810") or the modified time.
export function entryMoment(entry: Entry): string {
  const stamp = /(?:^|[^0-9])((?:19|20)\d{6})[_-](\d{6})/.exec(entry.name);
  if (stamp) return stamp[1] + stamp[2];
  return entry.modified ? entry.modified.replace(/[^0-9]/g, "").slice(0, 14) : "";
}

export function applyFilters(entries: Entry[], filters: Filters): Entry[] {
  const words = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
  const dated = filters.from !== "" || filters.to !== "";
  const shown = entries.filter((entry) => {
    const name = entry.name.toLowerCase();
    if (words.some((w) => !name.includes(w))) return false;
    if (filters.type === "folder" && !entry.isDir) return false;
    if (filters.type !== "all" && filters.type !== "folder" && (entry.isDir || fileType(entry.name) !== filters.type)) return false;
    if (filters.minSize > 0 && (entry.isDir || entry.size < filters.minSize)) return false;
    if (dated) {
      const month = entryMonth(entry);
      if (!month || (filters.from && month < filters.from) || (filters.to && month > filters.to)) return false;
    }
    return true;
  });
  const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const folderFirst = (a: Entry, b: Entry) => Number(b.isDir) - Number(a.isDir);
  const compare: Record<Sort, (a: Entry, b: Entry) => number> = {
    name: (a, b) => folderFirst(a, b) || byName(a, b),
    newest: (a, b) => folderFirst(a, b) || entryMoment(b).localeCompare(entryMoment(a)) || byName(a, b),
    oldest: (a, b) => folderFirst(a, b) || entryMoment(a).localeCompare(entryMoment(b)) || byName(a, b),
    largest: (a, b) => folderFirst(a, b) || b.size - a.size || byName(a, b),
    smallest: (a, b) => folderFirst(a, b) || a.size - b.size || byName(a, b),
  };
  return shown.sort(compare[filters.sort]);
}
