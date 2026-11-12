import { Suspense } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { formatBytes } from "@/lib/files";
import { expiresAt, listTrash, trashDays } from "@/lib/trash";
import { readBins } from "@/lib/recycle";
import { BinList } from "./bin-list";
import { TrashList } from "./trash-list";

async function Trash() {
  await requireAdmin();
  const items = await listTrash();
  const days = trashDays();
  const total = items.reduce((n, i) => n + i.size, 0);
  return (
    <>
      <p className="text-muted text-sm">
        Router files deleted in Files wait here for {days} days, then they&apos;re deleted for good. They still use space
        on their drive until then{total ? ` (${formatBytes(total)} in files, plus any folders)` : ""}.
      </p>
      <TrashList
        items={items.map((i) => ({
          id: i.id,
          share: i.share,
          original: i.original,
          isDir: i.isDir,
          size: i.size,
          deletedBy: i.deletedBy,
          deletedAt: i.deletedAt.toISOString(),
          expiresAt: expiresAt(i.deletedAt, days).toISOString(),
        }))}
      />
    </>
  );
}

// SRM's own recycle bins: sizes from the last background check (src/lib/recycle.ts).
async function RecycleBins() {
  await requireAdmin();
  const summary = await readBins();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Router recycle bins</h2>
      <p className="text-muted text-sm">
        Files deleted from a share over the network (Windows, apps) went to that share&apos;s own recycle bin on the
        router, which SRM doesn&apos;t show. The bins are switched off now, but what&apos;s in them still uses space until
        it&apos;s emptied. Sizes are checked every 6 hours.
      </p>
      <BinList bins={summary.bins} checkedAt={summary.checkedAt} />
    </section>
  );
}

export default function TrashPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="brand-text text-3xl font-bold">Trash</h1>
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
        <Trash />
      </Suspense>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <RecycleBins />
      </Suspense>
    </main>
  );
}
