import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ sql: vi.fn(), recordAudit: vi.fn() }));
const { excluded, mirrorConfig, onlyOnBackup } = await import("./mirror");

describe("media backup", () => {
  it("backs up photo, video and music to media-backup unless told otherwise", () => {
    expect(mirrorConfig({})).toEqual({ target: "media-backup", shares: ["photo", "video", "music"] });
    expect(mirrorConfig({ MIRROR_TARGET: "b", MIRROR_SHARES: "photo, video" })).toEqual({ target: "b", shares: ["photo", "video"] });
  });

  it("never treats recycle bins, thumbnails, the hub's Trash or Windows clutter as files", () => {
    expect(excluded("#recycle/2024/a.jpg")).toBe(true);
    expect(excluded("@eaDir/x")).toBe(true);
    expect(excluded("2024/2024-05/@eaDir/a.jpg/SYNOPHOTO_THUMB_M.jpg")).toBe(true);
    expect(excluded(".hub-trash/1/a.jpg")).toBe(true);
    expect(excluded("2024/Thumbs.db")).toBe(true);
    expect(excluded("2024/2024-05/a.jpg")).toBe(false);
  });

  it("lists only real files that are on the backup but gone from the main drive", () => {
    const main = ["2024/2024-05/a.jpg", "2024/2024-05/b.jpg"];
    const backup = new Map([
      ["2024/2024-05/a.jpg", 10],
      ["2024/2024-05/b.jpg", 20],
      ["2023/old.jpg", 30],
      ["2023/@eaDir/old.jpg/thumb.jpg", 1],
      ["desktop.ini", 1],
    ]);
    expect(onlyOnBackup(main, backup)).toEqual([{ path: "2023/old.jpg", size: 30 }]);
  });
});
