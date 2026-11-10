import { Suspense } from "react";
import Link from "next/link";
import { currentUser } from "@/lib/access";
import { visibleApps } from "@/lib/apps";
import { backupWarning } from "@/lib/backups";
import { healthWarning } from "@/lib/cluster-health";
import { listManagedApps } from "@/lib/db";
import { AppSearch } from "./app-search";
import { AppTile } from "./app-tile";
import { HelpButton } from "./help-button";
import { visibleHelpDocs } from "@/lib/help-docs";
import { AutoRefresh } from "./auto-refresh";
import { SignOutButton } from "./sign-out-button";

async function BackupWarning() {
  const warning = await backupWarning();
  if (!warning) return null;
  return (
    <Link href="/manage/backups" role="alert" className="panel px-5 py-3 text-(--down)">
      {warning}
    </Link>
  );
}

async function HealthWarning() {
  const warning = await healthWarning();
  if (!warning) return null;
  return (
    <Link href="/manage/health" role="alert" className="panel px-5 py-3 text-(--down)">
      {warning}
    </Link>
  );
}

async function Portal() {
  const user = await currentUser();
  const apps = visibleApps(await listManagedApps(), user.level);
  const categories = [...new Set(apps.map((app) => app.category))];

  return (
    <>
      <AutoRefresh seconds={30} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted">
          {user.name} · {user.level} access · Version {process.env.APP_VERSION ?? "dev"}
        </p>
        <span className="flex flex-wrap items-center gap-2">
          <AppSearch items={apps.map(({ id, name, description, url }) => ({ id, name, description, url }))} />
          {user.level === "admin" && (
            <Link href="/manage" className="btn-quiet">
              Manage apps
            </Link>
          )}
          <HelpButton
            docs={visibleHelpDocs(user.level).map(({ slug, title, description, updated }) => ({ slug, title, description, updated }))}
          />
          <SignOutButton />
        </span>
      </div>
      {user.level === "admin" && (
        <Suspense fallback={null}>
          <BackupWarning />
        </Suspense>
      )}
      {user.level === "admin" && (
        <Suspense fallback={null}>
          <HealthWarning />
        </Suspense>
      )}
      {apps.length === 0 && (
        <p className="panel text-muted p-10 text-center text-lg">No apps have been added for your account yet.</p>
      )}
      {categories.map((category) => (
        <section key={category} className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{category}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {apps
              .filter((app) => app.category === category)
              .map((app, index) => (
                <li key={app.id}>
                  <AppTile app={app} index={index} />
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8">
      <h1 className="flex items-center gap-3 sm:gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG, nothing to optimize */}
        <img src="/icon.svg" alt="" width={64} height={64} className="size-10 sm:size-16" />
        <span className="brand-text text-4xl font-bold tracking-tight sm:text-6xl">Home Lab Hub</span>
      </h1>
      <Suspense fallback={<p className="text-muted text-lg">Loading…</p>}>
        <Portal />
      </Suspense>
    </main>
  );
}
