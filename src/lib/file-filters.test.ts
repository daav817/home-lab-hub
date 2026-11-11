import { describe, expect, it } from "vitest";
import { applyFilters, isFiltered, NO_FILTERS } from "./file-filters";
import type { Entry } from "./files";

const e = (name: string, size = 1, isDir = false, modified: string | null = null): Entry => ({ name, size, isDir, modified });
const entries = [
  e("Screenshots", 0, true),
  e("20251224_222810.mp4", 2.4e9),
  e("20200509_162207.jpg", 1.8e6),
  e("Resume (01-02-2023).docx", 30e3, false, "2023-01-02T10:00:00Z"),
  e("Screenshot_20240302_101010_YouTube.jpg", 300e3),
];
const names = (list: Entry[]) => list.map((x) => x.name);

describe("file filters", () => {
  it("shows everything, folders first, by default", () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(names(applyFilters(entries, NO_FILTERS))[0]).toBe("Screenshots");
    expect(applyFilters(entries, NO_FILTERS)).toHaveLength(5);
  });

  it("searches every word of the name", () => {
    expect(names(applyFilters(entries, { ...NO_FILTERS, query: "screenshot youtube" }))).toEqual(["Screenshot_20240302_101010_YouTube.jpg"]);
  });

  it("filters by type, size and taken month", () => {
    expect(names(applyFilters(entries, { ...NO_FILTERS, type: "video" }))).toEqual(["20251224_222810.mp4"]);
    expect(names(applyFilters(entries, { ...NO_FILTERS, type: "folder" }))).toEqual(["Screenshots"]);
    expect(names(applyFilters(entries, { ...NO_FILTERS, minSize: 1e9 }))).toEqual(["20251224_222810.mp4"]);
    expect(names(applyFilters(entries, { ...NO_FILTERS, from: "2023-01", to: "2024-12" }))).toEqual([
      "Resume (01-02-2023).docx",
      "Screenshot_20240302_101010_YouTube.jpg",
    ]);
  });

  it("sorts by the date in the name, or by size", () => {
    expect(names(applyFilters(entries, { ...NO_FILTERS, type: "photo", sort: "newest" }))).toEqual([
      "Screenshot_20240302_101010_YouTube.jpg",
      "20200509_162207.jpg",
    ]);
    expect(names(applyFilters(entries, { ...NO_FILTERS, sort: "largest" })).slice(0, 2)).toEqual(["Screenshots", "20251224_222810.mp4"]);
  });
});
