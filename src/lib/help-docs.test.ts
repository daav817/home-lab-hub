import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findHelpDoc, helpDocs, visibleHelpDocs } from "./help-docs";

describe("help documents", () => {
  it("each entry has its PDF in help/ and a unique slug", () => {
    const slugs = new Set<string>();
    for (const doc of helpDocs) {
      expect(existsSync(join(process.cwd(), "help", doc.file)), doc.file).toBe(true);
      expect(doc.file.endsWith(".pdf")).toBe(true);
      expect(slugs.has(doc.slug)).toBe(false);
      slugs.add(doc.slug);
    }
  });

  it("shows admins everything and family only family documents", () => {
    expect(visibleHelpDocs("admin").map((d) => d.slug)).toEqual(["how-it-works", "architecture"]);
    expect(visibleHelpDocs("family").map((d) => d.slug)).toEqual(["how-it-works"]);
    expect(visibleHelpDocs("limited")).toEqual([]);
  });

  it("refuses unknown, malformed and not-allowed documents", () => {
    expect(findHelpDoc("architecture", "family")).toBeNull();
    expect(findHelpDoc("../package.json", "admin")).toBeNull();
    expect(findHelpDoc("nope", "admin")).toBeNull();
    expect(findHelpDoc("how-it-works", "family")?.file).toBe("how-it-works.pdf");
  });
});
