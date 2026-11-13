import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ sql: vi.fn(), recordAudit: vi.fn() }));
const { compareDrives, excluded, mirrorConfig } = await import("./mirror");

describe("media backup", () => {
  it("backs up photo, video and music from usbshare1 to media-backup on usbshare2 unless told otherwise", () => {
    expect(mirrorConfig({})).toEqual({
      target: "media-backup", shares: ["photo", "video", "music"], mainDrive: "usbshare1", backupDrive: "usbshare2",
    });
    expect(mirrorConfig({ MIRROR_TARGET: "b", MIRROR_SHARES: "photo, video" })).toMatchObject({ target: "b", shares: ["photo", "video"] });
  });

  it("never treats recycle bins, thumbnails, the hub's Trash or Windows clutter as files", () => {
    expect(excluded("#recycle/2024/a.jpg")).toBe(true);
    expect(excluded("@eaDir/x")).toBe(true);
    expect(excluded("2024/2024-05/@eaDir/a.jpg/SYNOPHOTO_THUMB_M.jpg")).toBe(true);
    expect(excluded(".hub-trash/1/a.jpg")).toBe(true);
    expect(excluded("2024/Thumbs.db")).toBe(true);
    expect(excluded("2024/2024-05/a.jpg")).toBe(false);
  });

  it("removes the old copy of a moved file only once the new folder's copy is backed up", () => {
    const main = new Map([["2010/2010-02/P1.JPG", 100], ["2010/2010-02/P2.JPG", 200]]);
    const backup = new Map([
      ["2010/2010-02/P1.JPG", 100], // new folder, backed up
      ["2010/2010 -02 Feb/P1.JPG", 100], // old folder: spare copy
      ["2010/2010 -02 Feb/P2.JPG", 200], // new folder's copy not on the backup yet: keep
      ["2010/2010 -02 Feb/p1.jpg", 100], // name case doesn't matter
    ]);
    expect(compareDrives(main, backup)).toEqual({
      moved: ["2010/2010 -02 Feb/p1.jpg", "2010/2010 -02 Feb/P1.JPG"],
      review: [{ path: "2010/2010 -02 Feb/P2.JPG", size: 200 }],
    });
  });

  it("keeps files that are only on the backup, and different versions with the same name, for review", () => {
    const main = new Map([["2017/2017-01/a.jpg", 300]]);
    const backup = new Map([
      ["2017/2017-01/a.jpg", 300],
      ["2017/a.jpg", 290], // same name, other size: a different version
      ["2010/Late Night Shots/P9.RW2", 14_000_000], // nowhere on the main drive
      ["2023/@eaDir/old.jpg/thumb.jpg", 1],
      ["desktop.ini", 1],
    ]);
    expect(compareDrives(main, backup)).toEqual({
      moved: [],
      review: [{ path: "2010/Late Night Shots/P9.RW2", size: 14_000_000 }, { path: "2017/a.jpg", size: 290 }],
    });
  });
});
