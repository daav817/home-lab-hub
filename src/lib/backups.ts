import { randomBytes } from "node:crypto";
import type { BackupRecord } from "./backup-history";
import { kube } from "./kube";

const api = "/apis/longhorn.io/v1beta2/namespaces/longhorn-system";
const nightlyLabel = "recurring-job-group.longhorn.io/critical-data=enabled";

// One day plus a few hours, so a slow nightly run doesn't show as late.
const lateAfter = 30 * 60 * 60 * 1000;

const names: Record<string, string> = {
  "authentik/data-authentik-postgresql-0": "Authentik logins",
  "default/petros-backups": "Petros export",
  "default/postgres-data-energia-postgres-0": "Energia database",
  "godseye/godseye-auth": "Godseye logins",
  "hub/data-hub-postgres-0": "Hub database",
  "investco/investco-postgres-pvc": "Investco database",
  "monitoring/kube-prometheus-stack-grafana": "Grafana dashboards",
};

export type Volume = {
  metadata: { name: string };
  status?: { kubernetesStatus?: { namespace?: string; pvcName?: string } };
};

export type Backup = {
  metadata: { name: string; creationTimestamp: string; labels?: Record<string, string> };
  status?: {
    state?: string;
    backupCreatedAt?: string;
    size?: string;
    error?: string;
    labels?: Record<string, string> | null;
  };
};

export type BackupHealth = "ok" | "running" | "late" | "failed" | "never";

export type VolumeBackups = {
  volume: string;
  name: string;
  health: BackupHealth;
  lastGoodAt: Date | null;
  size: number;
  error: string;
  history: BackupRecord[];
};

// A message that is safe to show on the page.
export class BackupError extends Error {}

const unfinished = ["", "New", "Pending", "InProgress"];

function takenAt(backup: Backup) {
  return new Date(backup.status?.backupCreatedAt || backup.metadata.creationTimestamp);
}

function toRecord(backup: Backup): BackupRecord {
  const state = backup.status?.state ?? "";
  return {
    id: backup.metadata.name,
    at: takenAt(backup),
    result: state === "Completed" ? "Completed" : unfinished.includes(state) ? "Running" : "Failed",
    trigger: backup.status?.labels?.RecurringJob ? "Nightly" : "Manual",
    size: Number(backup.status?.size ?? 0),
  };
}

export function summarize(volumes: Volume[], backups: Backup[], now: Date): VolumeBackups[] {
  const rows = volumes.map((volume) => {
    const claim = volume.status?.kubernetesStatus;
    const key = `${claim?.namespace}/${claim?.pvcName}`;
    const own = backups
      .filter((backup) => backup.metadata.labels?.["backup-volume"] === volume.metadata.name)
      .sort((a, b) => takenAt(b).getTime() - takenAt(a).getTime());

    const newest = own[0];
    const lastGood = own.find((backup) => backup.status?.state === "Completed");
    const state = newest?.status?.state ?? "";

    let health: BackupHealth;
    if (!newest) health = "never";
    else if (unfinished.includes(state)) health = "running";
    else if (state !== "Completed") health = "failed";
    else if (now.getTime() - takenAt(newest).getTime() > lateAfter) health = "late";
    else health = "ok";

    return {
      volume: volume.metadata.name,
      name: names[key] ?? key,
      health,
      lastGoodAt: lastGood ? takenAt(lastGood) : null,
      size: Number(lastGood?.status?.size ?? 0),
      error: health === "failed" ? (newest?.status?.error ?? "") : "",
      history: own.map(toRecord),
    };
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readBackups() {
  const [volumes, backups, target] = await Promise.all([
    kube<{ items: Volume[] }>(`${api}/volumes?labelSelector=${encodeURIComponent(nightlyLabel)}`),
    kube<{ items: Backup[] }>(`${api}/backups`),
    kube<{ status?: { available?: boolean } }>(`${api}/backuptargets/default`),
  ]);
  const checkedAt = new Date();
  return {
    rows: summarize(volumes.items, backups.items, checkedAt),
    targetAvailable: target.status?.available === true,
    checkedAt,
  };
}

// Shown on the home page, so a problem is seen without opening the backups page.
export async function backupWarning(): Promise<string | null> {
  try {
    const { rows, targetAvailable } = await readBackups();
    if (!targetAvailable) return "Longhorn can't reach the backup folder on the router.";
    const bad = rows.filter((row) => ["failed", "late", "never"].includes(row.health));
    if (bad.length > 0) return `${bad.length} backup${bad.length === 1 ? " needs" : "s need"} attention.`;
    return null;
  } catch {
    return "Backup status isn't available right now.";
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSnapshot(name: string, tries: number, gap: number) {
  for (let i = 0; i < tries; i++) {
    const snapshot = await kube<{ status?: { readyToUse?: boolean } }>(`${api}/snapshots/${name}`);
    if (snapshot.status?.readyToUse) return;
    await pause(gap);
  }
  throw new BackupError("The snapshot took too long. Check the volume in Longhorn.");
}

// Same two steps as Longhorn's own button. Names keep Longhorn's format, which the
// backup folder relies on.
export async function startBackup(volume: string, { tries = 20, gap = 1000 } = {}): Promise<string> {
  const { rows, targetAvailable } = await readBackups();
  const row = rows.find((candidate) => candidate.volume === volume);

  if (!row) throw new BackupError("That volume isn't in the nightly backup.");
  if (!targetAvailable) throw new BackupError("The backup folder on the router isn't available.");
  if (row.health === "running") throw new BackupError("A backup of this volume is already running.");

  const id = randomBytes(8).toString("hex");
  const namespace = "longhorn-system";

  await kube(`${api}/snapshots`, {
    apiVersion: "longhorn.io/v1beta2",
    kind: "Snapshot",
    metadata: { name: `snap-${id}`, namespace },
    spec: { volume, createSnapshot: true },
  });
  await waitForSnapshot(`snap-${id}`, tries, gap);
  await kube(`${api}/backups`, {
    apiVersion: "longhorn.io/v1beta2",
    kind: "Backup",
    metadata: {
      name: `backup-${id}`,
      namespace,
      labels: { "backup-target": "default", "backup-volume": volume },
    },
    spec: { snapshotName: `snap-${id}`, backupMode: "incremental", labels: {} },
  });
  return row.name;
}
