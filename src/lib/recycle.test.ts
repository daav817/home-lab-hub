import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ sql: vi.fn() }));
const { inBin, RECYCLE, sortBins, withBin } = await import("./recycle");
const { parsePath } = await import("./files");

describe("recycle bins", () => {
  it("puts paths inside the share's #recycle folder", () => {
    expect(inBin("photo", ["2024", "a.jpg"])).toEqual({ share: "photo", parts: [RECYCLE, "2024", "a.jpg"] });
    expect(inBin("photo", [])).toEqual({ share: "photo", parts: ["#recycle"] });
  });

  it("accepts bin paths as Files paths but not ones that climb out", () => {
    expect(parsePath(["Public_WD", "#recycle", "Old"])).not.toBeNull();
    expect(parsePath(["Public_WD", "..", "x"])).toBeNull();
  });

  it("lists the biggest bins first and empty ones by name", () => {
    const bins = sortBins([
      { share: "music", bytes: 0, files: 0 },
      { share: "photo", bytes: 2_900_000_000, files: 1046 },
      { share: "Public_WD", bytes: 150_500_000_000, files: 6651 },
      { share: "camera", bytes: 0, files: 0 },
    ]);
    expect(bins.map((b) => b.share)).toEqual(["Public_WD", "photo", "camera", "music"]);
  });

  it("replaces one share's figures and keeps the rest", () => {
    const summary = { checkedAt: "2026-11-12T22:00:00.000Z", bins: [{ share: "photo", bytes: 10, files: 1 }, { share: "video", bytes: 5, files: 1 }] };
    const next = withBin(summary, { share: "photo", bytes: 0, files: 0 });
    expect(next.checkedAt).toBe(summary.checkedAt);
    expect(next.bins).toEqual([{ share: "video", bytes: 5, files: 1 }, { share: "photo", bytes: 0, files: 0 }]);
  });
});
