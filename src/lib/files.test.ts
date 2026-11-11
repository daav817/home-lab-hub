import { describe, expect, it } from "vitest";
import {
  cleanName, disposition, driveMetrics, driveWarnings, folderHref, groupDrives, inlineType, joinPath, parsePath,
  previewKind, rawHref, toEntries,
} from "./files";

describe("names and paths", () => {
  it("accepts ordinary names", () => {
    expect(cleanName("Beach 2024.jpg")).toBe("Beach 2024.jpg");
    expect(cleanName("  Trim me ")).toBe("Trim me");
  });

  it("rejects separators, reserved characters and dot names", () => {
    for (const bad of ["", ".", "..", "a/b", "a\b", "a:b", "what?", "x*", 'q"', "<x>", "p|q", "ends.", "ends .", "\u0001x", "x".repeat(256)]) {
      expect(cleanName(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("parses a share and folders", () => {
    expect(parsePath("photo/2024/Beach")).toEqual({ share: "photo", parts: ["2024", "Beach"] });
    expect(parsePath(["video"])).toEqual({ share: "video", parts: [] });
  });

  it("refuses anything that climbs out or isn't clean", () => {
    for (const bad of ["", "/", "photo/../k8s-storage-folder", "photo/./x", "photo/a\..\b", "photo/ spaced", ["photo", ".."]]) {
      expect(parsePath(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("builds links with every piece encoded", () => {
    const path = { share: "photo", parts: ["Mom & Dad", "100%.jpg"] };
    expect(joinPath(path)).toBe("photo/Mom & Dad/100%.jpg");
    expect(folderHref(path)).toBe("/files/photo/Mom%20%26%20Dad/100%25.jpg");
    expect(rawHref(path, true)).toBe("/api/files/raw?path=photo%2FMom%20%26%20Dad%2F100%25.jpg&download=1");
  });
});

describe("what is shown inline", () => {
  it("shows media and PDFs, downloads everything else", () => {
    expect(inlineType("a.JPG")).toBe("image/jpeg");
    expect(previewKind("clip.mp4")).toBe("video");
    expect(previewKind("song.flac")).toBe("audio");
    expect(previewKind("doc.pdf")).toBe("pdf");
    for (const active of ["page.html", "page.htm", "logo.svg", "x.js", "x.xml", "noext"]) {
      expect(inlineType(active), active).toBeNull();
    }
  });

  it("writes a safe Content-Disposition for any name", () => {
    expect(disposition("attachment", 'Ré"sumé.pdf')).toBe(
      `attachment; filename="R__sum_.pdf"; filename*=UTF-8''R%C3%A9%22sum%C3%A9.pdf`,
    );
  });
});

describe("drives", () => {
  const shares = [
    { name: "video", total: 4000, used: 3500, free: 500 },
    { name: "photo", total: 4000, used: 1000, free: 3000 },
    { name: "music", total: 4000, used: 1000, free: 3000 },
    { name: "empty", total: 0, used: 0, free: 0 },
  ];

  it("groups shares that report the same drive", () => {
    expect(groupDrives(shares)).toEqual([
      { shares: ["music", "photo"], total: 4000, used: 1000, free: 3000 },
      { shares: ["video"], total: 4000, used: 3500, free: 500 },
    ]);
  });

  it("warns at 85% and over", () => {
    expect(driveWarnings(groupDrives(shares))).toEqual(["Router drive with video is 88% full."]);
  });

  it("writes Prometheus metrics", () => {
    const text = driveMetrics(groupDrives(shares), true);
    expect(text).toContain("hub_router_files_up 1");
    expect(text).toContain('hub_router_drive_used_bytes{shares="video"} 3500');
    expect(text).toContain('hub_router_drive_size_bytes{shares="music,photo"} 4000');
    expect(driveMetrics([], false)).toContain("hub_router_files_up 0");
  });
});

describe("listings", () => {
  it("puts folders first, sorts numbers naturally and hides system folders", () => {
    const entries = toEntries([
      { Name: "img10.jpg", IsDir: false, Size: 5, ModTime: "2024-05-01T10:00:00Z" },
      { Name: "img2.jpg", IsDir: false, Size: 5, ModTime: "2024-05-01T10:00:00Z" },
      { Name: "Trips", IsDir: true, Size: -1, ModTime: "2000-01-01T00:00:00Z" },
      { Name: "#recycle", IsDir: true, Size: -1 },
      { Name: "@eaDir", IsDir: true, Size: -1 },
    ]);
    expect(entries.map((e) => e.name)).toEqual(["Trips", "img2.jpg", "img10.jpg"]);
    expect(entries[0]).toEqual({ name: "Trips", isDir: true, size: 0, modified: null });
  });
});

describe("the Trash folder", () => {
  it("can't be named, reached by a path, or seen in a listing", () => {
    expect(cleanName(".hub-trash")).toBeNull();
    expect(cleanName(".HUB-TRASH")).toBeNull();
    expect(parsePath("photo/.hub-trash/123")).toBeNull();
    expect(toEntries([{ Name: ".hub-trash", IsDir: true, Size: -1 }, { Name: "a.jpg", IsDir: false, Size: 1 }]).map((e) => e.name)).toEqual(["a.jpg"]);
  });
});
