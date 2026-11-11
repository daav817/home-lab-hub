import { describe, expect, it } from "vitest";
import { destination, fileType, inSource, isLoose, mediaKind, monthFolder, organizeConfig, planMoves, takenMonth, tidyTarget } from "./media";

const now = new Date("2026-11-11T12:00:00Z");
const config = organizeConfig({});

describe("media", () => {
  it("moves only JPG/PNG photos and MP4/AVI videos", () => {
    expect(mediaKind("20251224_222810.JPG")).toBe("photo");
    expect(mediaKind("a.png")).toBe("photo");
    expect(mediaKind("a.mp4")).toBe("video");
    expect(mediaKind("a.AVI")).toBe("video");
    expect(mediaKind("a.gif")).toBeNull();
    expect(mediaKind("a.docx")).toBeNull();
    expect(fileType("a.heic")).toBe("photo");
    expect(fileType("x.MTS")).toBe("video");
    expect(fileType("resume.docx")).toBe("document");
  });

  it("reads the month from phone file names", () => {
    expect(takenMonth("20251224_222810.mp4", null, now)).toEqual({ year: 2025, month: 12 });
    expect(takenMonth("20200509_162207_123.jpg", null, now)).toEqual({ year: 2020, month: 5 });
    expect(takenMonth("VID_20190101_192231339.mp4", null, now)).toEqual({ year: 2019, month: 1 });
    expect(takenMonth("Screenshot_20240302_101010_YouTube.jpg", null, now)).toEqual({ year: 2024, month: 3 });
    expect(takenMonth("20230730_103305(1).mp4", null, now)).toEqual({ year: 2023, month: 7 });
  });

  it("uses an epoch stamp, then the modified time, and rejects nonsense", () => {
    // 1700000000000 = 2023-11-14T22:13:20Z
    expect(takenMonth("dji_export_1700000000000.mp4", null, now)).toEqual({ year: 2023, month: 11 });
    // a bad stamp (month 13) falls back to the modified time, in New York time
    expect(takenMonth("20251399_000000.jpg", "2024-01-01T03:00:00Z", now)).toEqual({ year: 2023, month: 12 });
    expect(takenMonth("20991224_222810.jpg", null, now)).toBeNull(); // in the future
    expect(takenMonth("IMG.jpg", null, now)).toBeNull();
  });

  it("builds year/year-month destinations like the existing folders", () => {
    expect(monthFolder({ year: 2025, month: 3 })).toBe("2025-03");
    expect(destination("a.jpg", "photo", { year: 2025, month: 12 }, config)).toEqual({ share: "photo", parts: ["2025", "2025-12", "a.jpg"] });
    expect(destination("a.mp4", "video", { year: 2021, month: 7 }, config)).toEqual({ share: "video", parts: ["2021", "2021-07", "a.mp4"] });
  });

  it("knows the upload folder and what is inside it", () => {
    expect(config.source).toEqual({ share: "Public_WD", parts: ["uploaded media"] });
    expect(inSource({ share: "Public_WD", parts: ["uploaded media"] }, config)).toBe(true);
    expect(inSource({ share: "Public_WD", parts: ["uploaded media", "video"] }, config)).toBe(true);
    expect(inSource({ share: "Public_WD", parts: ["MyData"] }, config)).toBe(false);
    expect(inSource({ share: "photo", parts: ["uploaded media"] }, config)).toBe(false);
  });

  it("plans a move without touching anything", () => {
    const plan = planMoves([
      { name: "20251224_222810.mp4", isDir: false, size: 100, modified: null },
      { name: "20251201_000000.jpg", isDir: false, size: 5, modified: null },
      { name: "20251202_000000.jpg", isDir: false, size: 5, modified: null },
      { name: "notes.docx", isDir: false, size: 1, modified: null },
      { name: "Screenshots", isDir: true, size: 0, modified: null },
      { name: "nodate.jpg", isDir: false, size: 1, modified: null },
    ], now);
    expect(plan).toMatchObject({ photos: 2, videos: 1, bytes: 110, months: 2 });
    expect(plan.skipped.map((s) => s.reason)).toEqual(["not a JPG, PNG, HEIC, MP4, AVI or MOV", "folder", "no date"]);
  });
});

describe("tidying photo and video", () => {
  it("only picks photos and videos lying straight in a year folder of photo or video", () => {
    expect(isLoose({ share: "photo", parts: ["2023", "20230101_201514.jpg"] }, config)).toBe(true);
    expect(isLoose({ share: "video", parts: ["2019", "x.MTS"] }, config)).toBe(true);
    expect(isLoose({ share: "photo", parts: ["2023", "Thumbs.db"] }, config)).toBe(false);
    expect(isLoose({ share: "photo", parts: ["2022", "2022-01", "a.jpg"] }, config)).toBe(false);
    expect(isLoose({ share: "photo", parts: ["Gallery Wall", "a.jpg"] }, config)).toBe(false);
    expect(isLoose({ share: "Public_WD", parts: ["2023", "a.jpg"] }, config)).toBe(false);
  });

  it("puts a loose file in its year's month folder, or leaves it when the year differs", () => {
    expect(tidyTarget({ share: "photo", parts: ["2023", "20230101_201514.jpg"] }, null, config, now)).toEqual({
      to: { share: "photo", parts: ["2023", "2023-01", "20230101_201514.jpg"] },
    });
    expect(tidyTarget({ share: "photo", parts: ["2004", "IMG_0533.JPG"] }, "2001-09-09T12:00:00Z", config, now)).toEqual({
      skip: "dated 2001-09, not 2004; left in the year folder",
    });
    expect(tidyTarget({ share: "video", parts: ["2021", "IMG_1.MOV"] }, "2021-06-15T12:00:00Z", config, now)).toEqual({
      to: { share: "video", parts: ["2021", "2021-06", "IMG_1.MOV"] },
    });
    expect(tidyTarget({ share: "photo", parts: ["2021", "41254.jpeg"] }, null, config, now)).toEqual({ skip: "no date" });
  });

  it("moves HEIC and MOV from the upload folder too", () => {
    expect(mediaKind("IMG_1234.HEIC")).toBe("photo");
    expect(mediaKind("clip.mov")).toBe("video");
  });
});
