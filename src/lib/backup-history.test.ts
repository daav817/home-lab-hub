import { describe, expect, it } from "vitest";
import { filterHistory, type BackupRecord, type HistoryFilters } from "./backup-history";

const records: BackupRecord[] = [
  { id: "a", at: new Date("2026-11-06T03:30:00Z"), result: "Completed", trigger: "Nightly", size: 2_097_152 },
  { id: "b", at: new Date("2026-11-05T03:30:00Z"), result: "Failed", trigger: "Nightly", size: 0 },
  { id: "c", at: new Date("2026-10-30T15:00:00Z"), result: "Completed", trigger: "Manual", size: 1_048_576 },
];

const everything: HistoryFilters = { query: "", result: "all", trigger: "all" };
const ids = (filters: Partial<HistoryFilters>) =>
  filterHistory(records, { ...everything, ...filters }, (at) => at.toISOString()).map((record) => record.id);

describe("filterHistory", () => {
  it("returns everything with no filters", () => {
    expect(ids({})).toEqual(["a", "b", "c"]);
  });

  it("filters by result", () => {
    expect(ids({ result: "Failed" })).toEqual(["b"]);
  });

  it("filters by trigger", () => {
    expect(ids({ trigger: "Manual" })).toEqual(["c"]);
  });

  it("combines filters", () => {
    expect(ids({ result: "Completed", trigger: "Nightly" })).toEqual(["a"]);
  });

  it("searches the shown date", () => {
    expect(ids({ query: "2026-10" })).toEqual(["c"]);
  });

  it("needs every search word to match, in any case", () => {
    expect(ids({ query: "NIGHTLY 2026-11-05" })).toEqual(["b"]);
    expect(ids({ query: "manual failed" })).toEqual([]);
  });
});
