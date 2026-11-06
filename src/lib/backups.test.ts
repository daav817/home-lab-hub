import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupError, startBackup, summarize, type Backup, type Volume } from "./backups";

const now = new Date("2026-11-06T12:00:00Z");
const volume: Volume = {
  metadata: { name: "pvc-1" },
  status: { kubernetesStatus: { namespace: "hub", pvcName: "data-hub-postgres-0" } },
};

function backup(state: string, at: string, name = "pvc-1"): Backup {
  return {
    metadata: { name: `backup-${at}`, creationTimestamp: at, labels: { "backup-volume": name } },
    status: { state, backupCreatedAt: at, size: "1000" },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("summarize", () => {
  it("uses a friendly name and ignores other volumes' backups", () => {
    const [row] = summarize([volume], [backup("Completed", "2026-11-06T03:30:00Z", "pvc-2")], now);
    expect(row).toMatchObject({ name: "Hub database", health: "never", lastGoodAt: null });
  });

  it("reports a recent backup as ok", () => {
    const [row] = summarize([volume], [backup("Completed", "2026-11-06T03:30:00Z")], now);
    expect(row).toMatchObject({ health: "ok", size: 1000 });
  });

  it("reports a backup older than 30 hours as late", () => {
    const [row] = summarize([volume], [backup("Completed", "2026-11-05T01:00:00Z")], now);
    expect(row.health).toBe("late");
  });

  it("reports the newest failure but keeps the last good time", () => {
    const [row] = summarize(
      [volume],
      [backup("Completed", "2026-11-05T03:30:00Z"), backup("Error", "2026-11-06T03:30:00Z")],
      now,
    );
    expect(row.health).toBe("failed");
    expect(row.lastGoodAt).toEqual(new Date("2026-11-05T03:30:00Z"));
  });

  it("lists every backup, newest first, with its result and trigger", () => {
    const nightly = backup("Completed", "2026-11-05T03:30:00Z");
    nightly.status!.labels = { RecurringJob: "nightly-backup" };
    const [row] = summarize([volume], [nightly, backup("Error", "2026-11-06T03:30:00Z")], now);

    expect(row.history.map(({ result, trigger }) => [result, trigger])).toEqual([
      ["Failed", "Manual"],
      ["Completed", "Nightly"],
    ]);
  });

  it.each(["", "New", "Pending", "InProgress"])("treats state %j as running", (state) => {
    const [row] = summarize([volume], [backup(state, "2026-11-06T11:59:00Z")], now);
    expect(row.health).toBe("running");
  });
});

type Post = { kind: string; metadata: { name: string; labels?: object }; spec: object };

function fakeCluster(backups: Backup[] = [], available = true) {
  const posts: Post[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === "POST") posts.push(JSON.parse(String(init.body)));
      let reply: object = {};
      if (url.includes("/volumes?")) reply = { items: [volume] };
      else if (url.endsWith("/backups") && init.method === "GET") reply = { items: backups };
      else if (url.endsWith("/backuptargets/default")) reply = { status: { available } };
      else if (url.includes("/snapshots/")) reply = { status: { readyToUse: true } };
      return new Response(JSON.stringify(reply));
    }),
  );
  return posts;
}

describe("startBackup", () => {
  it("creates a snapshot, then a backup of it", async () => {
    const posts = fakeCluster();
    await expect(startBackup("pvc-1")).resolves.toBe("Hub database");

    expect(posts.map((post) => post.kind)).toEqual(["Snapshot", "Backup"]);
    const [snapshot, created] = posts;
    expect(snapshot.metadata.name).toMatch(/^snap-[0-9a-f]{16}$/);
    expect(created.metadata.name).toMatch(/^backup-[0-9a-f]{16}$/);
    expect(created.spec).toMatchObject({ snapshotName: snapshot.metadata.name });
    expect(created.metadata.labels).toEqual({ "backup-target": "default", "backup-volume": "pvc-1" });
  });

  it("refuses a volume outside the nightly backup", async () => {
    const posts = fakeCluster();
    await expect(startBackup("pvc-other")).rejects.toBeInstanceOf(BackupError);
    expect(posts).toEqual([]);
  });

  it("refuses while a backup is running", async () => {
    const posts = fakeCluster([backup("InProgress", new Date().toISOString())]);
    await expect(startBackup("pvc-1")).rejects.toThrow("already running");
    expect(posts).toEqual([]);
  });

  it("refuses when the router folder is unavailable", async () => {
    const posts = fakeCluster([], false);
    await expect(startBackup("pvc-1")).rejects.toThrow("isn't available");
    expect(posts).toEqual([]);
  });
});
