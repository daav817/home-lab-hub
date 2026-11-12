import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { FilesError, parsePath, type FilePath } from "@/lib/files";
import { listBin, RECYCLE } from "@/lib/recycle";
import { binHref } from "../../bin-href";
import { BinBrowser } from "./bin-browser";

type Params = { path?: string[] };

function Breadcrumbs({ path }: { path: FilePath }) {
  const crumbs = [path.share, ...path.parts];
  return (
    <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
      <Link href="/manage/trash" className="underline">
        Trash
      </Link>
      {crumbs.map((name, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="text-muted">/</span>
          {i === crumbs.length - 1 ? (
            <span className="font-medium">{i === 0 ? `${name} recycle bin` : name}</span>
          ) : (
            <Link href={binHref(crumbs[0], crumbs.slice(1, i + 1))} className="underline">
              {i === 0 ? `${name} recycle bin` : name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

async function Bin({ params }: { params: Promise<Params> }) {
  await requireAdmin();
  const raw = (await params).path ?? [];
  const decode = (p: string) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  };
  const path = raw.length ? parsePath(raw.map(decode)) : null;
  if (!path || path.parts.includes(RECYCLE)) notFound();
  let entries;
  try {
    entries = await listBin(path.share, path.parts);
  } catch (error) {
    if (error instanceof FilesError && error.status === 404) notFound();
    return (
      <p role="alert" className="panel px-5 py-3 text-(--down)">
        {error instanceof FilesError ? error.message : "Couldn't read the recycle bin."}
      </p>
    );
  }
  return (
    <>
      <Breadcrumbs path={path} />
      <p className="text-muted text-sm">
        Restore puts an item back where it was deleted from in {path.share}. Delete forever frees its space.
      </p>
      <BinBrowser share={path.share} parts={path.parts} entries={entries} />
    </>
  );
}

export default function BinPage({ params }: { params: Promise<Params> }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="brand-text text-3xl font-bold">Recycle bin</h1>
        <Link href="/manage/trash" className="underline">
          Back to Trash
        </Link>
      </header>
      <Suspense fallback={<p className="text-muted">Reading the recycle bin from the router…</p>}>
        <Bin params={params} />
      </Suspense>
    </main>
  );
}
