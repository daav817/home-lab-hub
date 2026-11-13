import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/access";
import {
  assertShare, canViewFiles, driveRatio, FilesError, folderHref, formatBytes, groupDrives, listFolder, listShares,
  parsePath, type FilePath,
} from "@/lib/files";
import { inSource, organizeConfig } from "@/lib/media";
import { FileBrowser } from "./file-browser";
import { MirrorPanel } from "./mirror-panel";

type Params = { path?: string[] };

function Problem({ message }: { message: string }) {
  return (
    <p role="alert" className="panel px-5 py-3 text-(--down)">
      {message}
    </p>
  );
}

function UsageBar({ used, total }: { used: number; total: number }) {
  const percent = Math.min(100, Math.round(driveRatio({ used, total }) * 100));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-foreground/10" aria-label={`${percent}% used`}>
      <div className={`h-full ${percent >= 85 ? "bg-(--down)" : "bg-(--cyan)"}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

async function Shares() {
  const admin = (await currentUser()).level === "admin";
  let shares;
  try {
    shares = await listShares();
  } catch (error) {
    return <Problem message={error instanceof FilesError ? error.message : "Couldn't reach the router."} />;
  }
  if (shares.length === 0) {
    return <Problem message="The hub's router account can't open any shares yet. Give it access in SRM (Control Panel > Shared Folder)." />;
  }
  const drives = groupDrives(shares);
  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shares.map((share) => (
          <li key={share.name}>
            <Link href={folderHref({ share: share.name, parts: [] })} className="panel flex flex-col gap-3 p-5 hover:border-(--cyan)">
              <span className="text-lg font-semibold">{share.name}</span>
              <UsageBar used={share.used} total={share.total} />
              <span className="text-muted text-sm">
                Drive: {formatBytes(share.free)} free of {formatBytes(share.total)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-muted text-sm">
        {drives.length} drive{drives.length === 1 ? "" : "s"} · {formatBytes(drives.reduce((n, d) => n + d.free, 0))} free in all.
        Shares appear here when the hub&apos;s router account is given access to them in SRM.
      </p>
      {admin && <MirrorPanel />}
    </>
  );
}

async function Folder({ path }: { path: FilePath }) {
  const user = await currentUser();
  let entries;
  try {
    await assertShare(path.share);
    entries = await listFolder(path);
  } catch (error) {
    if (error instanceof FilesError && error.status === 404) notFound();
    return <Problem message={error instanceof FilesError ? error.message : "Couldn't read that folder."} />;
  }
  const admin = user.level === "admin";
  const config = organizeConfig();
  const organize = admin && inSource(path, config);
  const atSource = organize && path.parts.length === config.source.parts.length;
  // The photo and video shares' own pages offer sorting loose files into month folders.
  const tidy = admin && path.parts.length === 0 && (path.share === config.photos || path.share === config.videos);
  return <FileBrowser folder={path} entries={entries} canManage={admin} organize={organize} atSource={atSource} tidy={tidy} />;
}

function Breadcrumbs({ path }: { path: FilePath | null }) {
  const crumbs = path ? [path.share, ...path.parts] : [];
  return (
    <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
      <Link href="/files" className="underline">
        All shares
      </Link>
      {crumbs.map((name, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="text-muted">/</span>
          {i === crumbs.length - 1 ? (
            <span className="font-medium">{name}</span>
          ) : (
            <Link href={folderHref({ share: crumbs[0], parts: crumbs.slice(1, i + 1) })} className="underline">
              {name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

async function Files({ params }: { params: Promise<Params> }) {
  const user = await currentUser();
  if (!canViewFiles(user.level)) redirect("/");
  const raw = (await params).path;
  // Segments may arrive URL-encoded; a name with a literal "%" that isn't an escape stays as is.
  const decode = (p: string) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  };
  const path = raw?.length ? parsePath(raw.map(decode)) : null;
  if (raw?.length && !path) notFound();
  return (
    <>
      <Breadcrumbs path={path} />
      {path ? <Folder path={path} /> : <Shares />}
    </>
  );
}

export default function FilesPage({ params }: { params: Promise<Params> }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="brand-text text-3xl font-bold">Files</h1>
        <Link href="/" className="underline">
          Back to hub
        </Link>
      </header>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Files params={params} />
      </Suspense>
    </main>
  );
}
