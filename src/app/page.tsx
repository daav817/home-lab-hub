import { Suspense } from "react";
import Link from "next/link";
import { currentUser } from "@/lib/access";
import { visibleApps } from "@/lib/apps";
import { listManagedApps } from "@/lib/db";
import { AppSearch } from "./app-search";
import { AppTile } from "./app-tile";
import { SignOutButton } from "./sign-out-button";

async function Portal() {
  const user = await currentUser();
  const apps = visibleApps(await listManagedApps(), user.level);
  const categories = [...new Set(apps.map((app) => app.category))];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted">
          {user.name} · {user.level} access
        </p>
        <span className="flex flex-wrap items-center gap-2">
          <AppSearch items={apps.map(({ id, name, description, url }) => ({ id, name, description, url }))} />
          {user.level === "admin" && (
            <Link href="/manage" className="btn-quiet">
              Manage apps
            </Link>
          )}
          <SignOutButton />
        </span>
      </div>
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
      <h1 className="brand-text text-4xl font-bold tracking-tight sm:text-6xl">Home Lab Hub</h1>
      <Suspense fallback={<p className="text-muted text-lg">Loading…</p>}>
        <Portal />
      </Suspense>
    </main>
  );
}
