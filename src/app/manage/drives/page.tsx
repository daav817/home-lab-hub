import { Suspense } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { DRIVE_WARN, driveRatio, FilesError, formatBytes, groupDrives, listShares } from "@/lib/files";

// The router's USB drives: usage per drive, worked out from the shares on it (see
// groupDrives). Prometheus alerts at the same 85% (k8s/monitoring.yaml).
async function Drives() {
  await requireAdmin();
  let shares;
  try {
    shares = await listShares();
  } catch (error) {
    return (
      <p role="alert" className="panel px-5 py-3 text-(--down)">
        {error instanceof FilesError ? error.message : "Couldn't reach the router."}
      </p>
    );
  }
  const drives = groupDrives(shares);
  if (drives.length === 0) {
    return <p className="panel text-muted px-5 py-4">The hub&apos;s router account can&apos;t open any shares yet, so no drives can be measured.</p>;
  }
  return (
    <>
      <ul className="flex flex-col gap-4">
        {drives.map((drive, i) => {
          const percent = Math.round(driveRatio(drive) * 100);
          const warn = driveRatio(drive) >= DRIVE_WARN;
          return (
            <li key={drive.shares.join(",")} className="panel flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-lg font-semibold">Drive {i + 1}</span>
                <span className={warn ? "text-(--down)" : "text-muted"}>
                  {percent}% used{warn ? " (over 85%)" : ""}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-foreground/10" aria-label={`${percent}% used`}>
                <div className={`h-full ${warn ? "bg-(--down)" : "bg-(--cyan)"}`} style={{ width: `${percent}%` }} />
              </div>
              <span className="text-muted text-sm">
                {formatBytes(drive.used)} used · {formatBytes(drive.free)} free · {formatBytes(drive.total)} in all
              </span>
              <span className="text-sm">
                Shares:{" "}
                {drive.shares.map((share, j) => (
                  <span key={share}>
                    {j > 0 && ", "}
                    <Link href={`/files/${encodeURIComponent(share)}`} className="underline">
                      {share}
                    </Link>
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-muted text-sm">
        Measured through the shares the hub&apos;s router account can open. A drive with none of them on it isn&apos;t
        shown. Disk health (S.M.A.R.T.) is checked in SRM: Control Panel &gt; Storage.
      </p>
    </>
  );
}

export default function DrivesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="brand-text text-3xl font-bold">Router drives</h1>
        <span className="flex gap-4">
          <Link href="/files" className="underline">
            Files
          </Link>
          <Link href="/manage" className="underline">
            Back to manage
          </Link>
        </span>
      </header>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Drives />
      </Suspense>
    </main>
  );
}
