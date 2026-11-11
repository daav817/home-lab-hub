"use client";

import { isFiltered, NO_FILTERS, type Filters, type Sort } from "@/lib/file-filters";

const SIZES: [number, string][] = [
  [0, "Any size"],
  [10e6, "Over 10 MB"],
  [100e6, "Over 100 MB"],
  [500e6, "Over 500 MB"],
  [1e9, "Over 1 GB"],
];

const SORTS: [Sort, string][] = [
  ["name", "Name"],
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["largest", "Largest first"],
  ["smallest", "Smallest first"],
];

// Dates are the month a photo or video was taken (from its name, like 20251224_222810.jpg),
// or the file's modified month when the name has no date.
export function FilterBar({ filters, onChange }: { filters: Filters; onChange: (next: Filters) => void }) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-wrap items-end gap-2" role="search">
      <input
        type="search"
        aria-label="Search names"
        placeholder="Search names, such as 2025 or Screenshot"
        value={filters.query}
        onChange={(e) => set("query", e.target.value)}
        className="field min-w-48 flex-1"
      />
      <select aria-label="Type" value={filters.type} onChange={(e) => set("type", e.target.value as Filters["type"])} className="field">
        <option value="all">All types</option>
        <option value="photo">Photos</option>
        <option value="video">Videos</option>
        <option value="audio">Audio</option>
        <option value="document">Documents</option>
        <option value="other">Other files</option>
        <option value="folder">Folders</option>
      </select>
      <label className="text-muted flex flex-col text-xs">
        From month
        <input type="month" value={filters.from} onChange={(e) => set("from", e.target.value)} className="field" />
      </label>
      <label className="text-muted flex flex-col text-xs">
        To month
        <input type="month" value={filters.to} onChange={(e) => set("to", e.target.value)} className="field" />
      </label>
      <select aria-label="Size" value={filters.minSize} onChange={(e) => set("minSize", Number(e.target.value))} className="field">
        {SIZES.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <select aria-label="Sort" value={filters.sort} onChange={(e) => set("sort", e.target.value as Sort)} className="field">
        {SORTS.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      {(isFiltered(filters) || filters.sort !== "name") && (
        <button type="button" className="underline text-sm" onClick={() => onChange(NO_FILTERS)}>
          Clear filters
        </button>
      )}
    </div>
  );
}
