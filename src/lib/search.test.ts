import { describe, expect, it } from "vitest";
import { searchApps } from "./search";

const items = [
  { id: "1", name: "CRM", description: "Customer records", url: "https://crm" },
  { id: "2", name: "PDF Edit", description: "Edit and sign PDFs", url: "https://pdf" },
];

describe("searchApps", () => {
  it("returns everything for an empty search", () => {
    expect(searchApps(items, "  ")).toHaveLength(2);
  });

  it("matches names and descriptions, ignoring case", () => {
    expect(searchApps(items, "crm")[0].name).toBe("CRM");
    expect(searchApps(items, "SIGN")[0].name).toBe("PDF Edit");
  });

  it("needs every word to match", () => {
    expect(searchApps(items, "edit crm")).toEqual([]);
  });
});
