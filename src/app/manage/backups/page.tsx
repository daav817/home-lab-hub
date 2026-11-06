import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/access";
import { megabytes } from "@/lib/backup-history";
import { readBackups, type BackupHealth, type VolumeBackups } from "@/lib/backups";
import { backUpNow } from "./actions";
import { BackUpNowButton, RefreshButton } from "./backup-buttons";
import { HistoryDialog } from "./history-dialog";

const longhornUrl = "https://longhorn.energiapower.llc";

const labels: Record<BackupHealth, { text: string; color: string }> = {
  ok: { text: "Backed up", color: "text-(--up)" },
  running: { text: "Running", color: "text-muted" },
  late: { text: "Late", color: "text-(--down)" },
  failed: { text: "Failed", color: "text-(--down)" },
  never: { text: "No backup yet", color: "text-(--down)" },
};

function age(from: Date, now: number) {
  const hours = Math.floor((now - from.getTime()) / 3_600_000);
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function Row({ row, now }: { row: VolumeBackups; now: number }) {
  const label = labels[row.health];
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span>
        <span className="font-medium">{row.name}</span>
        <span className="text-muted block text-sm">
          <span className={label.color}>{label.text}</span>
          {row.lastGoodAt && ` · last good ${age(row.lastGoodAt, now)} · ${megabytes(row.size)}`}
        </span>
        {row.error && <span className="block text-sm text-(--down)">{row.error}</span>}
      </span>
      <span className="flex items-center gap-4">
        {row.history.length > 0 && <HistoryDialog name={row.name} records={row.history} />}
        <BackUpNowButton action={backUpNow.bind(null, row.volume)} />
      </span>
    </li>
  );
}

async function Backups() {
  const user = await currentUser();
  if (user.level !== "admin") redirect("/");

  let data: Awaited<ReturnType<typeof readBackups>>;
  try {
    data = await readBackups();
  } catch (error) {
    console.error("Backup status failed", error);
    return <p className="panel p-5 text-(--down)">Backup status isn&apos;t available right now.</p>;
  }

  const now = data.checkedAt.getTime();
  return (
    <>
      {!data.targetAvailable && (
        <p role="alert" className="panel p-5 text-(--down)">
          Longhorn can&apos;t reach the backup folder on the router.
        </p>
      )}
      <ul className="panel flex flex-col divide-y divide-foreground/10 px-5">
        {data.rows.map((row) => (
          <Row key={row.volume} row={row} now={now} />
        ))}
      </ul>
      <section className="panel flex flex-col gap-2 p-5">
        <h2 className="text-xl font-medium">Restore or delete</h2>
        <p className="text-muted">
          These can overwrite or remove data, so they stay in Longhorn. The hub can only view backups and start new
          ones.
        </p>
        <a href={longhornUrl} className="underline">
          Open Longhorn
        </a>
      </section>
    </>
  );
}

export default function BackupsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="brand-text text-3xl font-bold">Backups</h1>
        <span className="flex gap-4">
          <RefreshButton />
          <Link href="/manage" className="underline">
            Back to manage
          </Link>
        </span>
      </header>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Backups />
      </Suspense>
    </main>
  );
}
