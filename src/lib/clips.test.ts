import { describe, expect, it } from "vitest";
import { byDay, canViewClips, cleanGroupName, clipQuery, CLIP_ID, gigabytes, type Clip } from "./clips";

const clip = (id: string, start: number): Clip => ({
  id, camera: "garage", cameraName: "Garage", start, seconds: 12, labels: ["person"], size: 1, group: null,
});

describe("canViewClips", () => {
  it("lets admins and family view, nobody else", () => {
    expect(canViewClips("admin")).toBe(true);
    expect(canViewClips("family")).toBe(true);
    expect(canViewClips("limited")).toBe(false);
    expect(canViewClips("none")).toBe(false);
  });
});

describe("cleanGroupName", () => {
  it("trims and collapses spaces", () => {
    expect(cleanGroupName("  Delivery   driver ")).toBe("Delivery driver");
  });
  it("rejects empty, long and odd names", () => {
    expect(cleanGroupName("   ")).toBeNull();
    expect(cleanGroupName("x".repeat(61))).toBeNull();
    expect(cleanGroupName("<script>")).toBeNull();
  });
});

describe("byDay", () => {
  it("groups consecutive clips by day, keeping order", () => {
    const days = byDay([clip("a", 300), clip("b", 200), clip("c", 100)], (start) => (start >= 200 ? "Tue" : "Mon"));
    expect(days.map((d) => [d.day, d.clips.map((c) => c.id)])).toEqual([["Tue", ["a", "b"]], ["Mon", ["c"]]]);
  });
});

describe("clipQuery", () => {
  it("prefers ungrouped over a group", () => {
    expect(clipQuery({ camera: "garage", group: "x", ungrouped: true })).toBe("limit=300&camera=garage&ungrouped=1");
  });
  it("passes a group", () => {
    expect(clipQuery({ group: "Deliveries" })).toBe("limit=300&group=Deliveries");
  });
});

describe("CLIP_ID and gigabytes", () => {
  it("accepts Frigate review ids and rejects paths", () => {
    expect(CLIP_ID.test("1794271018.201965-03quzc")).toBe(true);
    expect(CLIP_ID.test("../etc/passwd")).toBe(false);
  });
  it("formats sizes", () => {
    expect(gigabytes(2_500_000_000)).toBe("2.50 GB");
    expect(gigabytes(123_400_000_000)).toBe("123.4 GB");
  });
});
